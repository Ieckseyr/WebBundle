# LSE 崩溃问题清单

> 对象：LegacyScriptEngine QuickJS 0.21.3（`legacy-script-engine-quickjs.dll`）
> 依据：`logs/crash` 的 5 份 dump/trace、LSE 源码、ScriptX `Global` 生命周期
> 结论：至少两条确定性缺陷，另有多处同类 `Global` 跨线程/跨引擎风险

---

## 0. 结论摘要

| 级别 | 问题 | 触发 | 后果 |
| --- | --- | --- | --- |
| P0 | `TimeTaskSystem` 协程帧持有 `script::Global`，引擎卸载时只清 map | `setTimeout` / `setInterval` 回调在引擎销毁前后析构 | `~Global` 在空 EngineScope 中写 `0x8` |
| P0 | `HttpServer` 请求把整个 `callbacks` 表按值复制进工作线程 | 每次 HTTP 请求结束/协程帧销毁 | `~HttpServerCallback` / `~Global` 在线程池释放 |
| P1 | `HttpServerClass::callbacks` 成员没有在引擎卸载前清理 | 插件卸载 / 热重载 | 整个回调表的 `Global` 晚于 QuickJS 运行时释放 |
| P1 | `HttpServerClass::listen` 的 detached 线程捕获裸 `this` | 停止/销毁 HttpServer | 监听线程访问已释放对象 |
| P1 | `network.httpGet/httpPost` 回调 `Global` 在 detached 线程中析构 | 网络请求返回/线程退出 | 同类 `~Global` 风险 |
| P2 | WebSocket 监听器持有 `Global`，回调表用裸指针传递 | WS 销毁/重连 | 指针失效、`Global` 析构时机不可控 |
| 待审计 | 文件、GUI、玩家异步 API 等也持有 `Global` | 异步完成/插件卸载 | 同类风险，需逐项确认 |

---

## 1. 已确认的崩溃证据

同机 5 次崩溃中，4 次直接落在 `~Global`，1 次是堆被写坏后的二次崩溃。

| 时间 | 存活 | 栈顶 | 归属 |
| --- | --- | --- | --- |
| 10-22 14:59:21 | 10:57:20 | `~Global+0x51` → `~pair<...,HttpServerCallback>` → 线程池 | HTTP 回调路径 |
| 10-26 18:15:27 | — | `mi_malloc+0x44`，`RAX="minecraf"` | 堆破坏后的二次崩溃 |
| 10-26 18:20:16 | — | `mi_malloc+0x44`，同样 `"minecraf"` | 堆破坏后的二次崩溃 |
| 10-26 18:36:43 | 0:08:27 | `~Global+0x51` → HTTP 回调表 → 线程池 | HTTP 回调路径 |
| 10-26 19:06:38 | 0:15:35 | `~Global+0x71` → `TimeTaskSystem` 协程 | 定时任务路径 |

`~Global+0x71` 指令：

```text
mov [rdx+8], r8
rdx = 0
```

符号：

```text
script::Global<script::Value>::~Global
  -> GlobalWeakBookkeeping::Bookkeeping::_Unlinknode
  -> ll::coro::keepThis<lambda at TimeTaskSystem.cpp:24>
  -> CoroTask::launch
  -> ServerThreadExecutor
```

这是 ScriptX 弱引用簿记链表在销毁 `Global` 时解引用 null 头节点，属于确定性生命周期错误，不是随机内存损坏。

---

## 2. P0：TimeTaskSystem 的协程帧持有 `Global`

文件：

```text
src/legacy/engine/TimeTaskSystem.cpp
```

### 2.1 数据结构

```cpp
struct TimeTaskData {
    script::Global<Function>           func;
    std::vector<script::Global<Value>> paras;
    script::Global<String>             code;
    ScriptEngine*                      engine = nullptr;
};
```

`TimeTaskData` 没有析构函数，也没有引擎级所有者；它只被按值捕获进协程帧。

### 2.2 四个入口全部相同

```text
NewTimeout(Function)   keepThis 第 42 行
NewTimeout(String)     keepThis 第 82 行
NewInterval(Function)  keepThis 第 119 行
NewInterval(String)    keepThis 第 161 行
```

每个入口都是：

```cpp
ll::coro::keepThis([timeout, tid, data]() -> CoroTask<> {
    co_await ...;
    if (!CheckTimeTask(tid)) {
        co_return;                 // 没有 EngineScope
    }

    if (engine = EngineManager::checkAndGet(data.engine);
        !engine || Stopping) {
        ClearTimeTask(tid);
        co_return;                 // 没有 EngineScope
    }

    EngineScope scope(engine.get());
    ...
}).launch(ServerThreadExecutor::getDefault());
```

问题不在回调执行时，而在**协程帧 `data` 被销毁时**：

- `data.func/paras/code` 是 `Global`
- `co_return` 时协程帧析构
- 此时 `EngineScope scope` 要么还没创建，要么已经离开作用域
- 当前引擎为空
- `~Global` 找不到当前引擎的簿记对象，解引用 null

另外，`TIMETASK_CATCH` 自身也是：

```cpp
catch (...) {
    EngineScope scope(data.engine);
    ...
}
```

如果异常发生在引擎已经销毁之后，`data.engine` 是野指针，这里构造 `EngineScope` 同样不安全。不能把 `TIMETASK_CATCH` 当作兜底保护。

### 2.3 引擎卸载清理不处理协程帧

```cpp
void LLSERemoveTimeTaskData(std::shared_ptr<ScriptEngine> const& engine) {
    EngineScope enter(engine.get());
    std::lock_guard lock(locker);
    for (auto it = timeTaskMap.begin(); it != timeTaskMap.end();) {
        if (it->second == engine.get()) {
            it = timeTaskMap.erase(it);
        } else {
            ++it;
        }
    }
}
```

它只从 `timeTaskMap` 删除 `tid -> engine*`：

- 不持有 `TimeTaskData`
- 不取消协程
- 不销毁协程帧里的 `Global`
- `EngineScope` 只覆盖 erase 操作，覆盖不到协程帧

注释写的是 “enter scope to prevent script::Global::~Global() from crashing”，但实际保护的只是 map，不是真正持有 `Global` 的对象。

### 2.4 触发条件

任意一个：

- `CheckTimeTask(tid)` 返回 false
- 引擎已经不在 `EngineManager`
- `GamingStatus == Stopping`
- 协程等待期间插件被卸载/热重载
- `setInterval` 在引擎销毁时仍处于 `co_await`

### 2.5 修复方向

不要只加 `EngineScope`。要满足：

1. `TimeTaskData` 由引擎持有
2. 引擎卸载时在 `EngineScope` 内清空 pending tasks
3. 协程帧不拥有最后的 `Global`
4. 取消/完成协程后由引擎侧释放数据

示意：

```cpp
auto dataPtr = std::make_shared<TimeTaskData>(std::move(data));
registerTask(tid, engineHolder, dataPtr);

// 引擎卸载时：
// EngineScope scope(engine);
// clearEngineTasks(engine);   // 析构 dataPtr 里的 Global
```

只把 `data` 改成 `shared_ptr` 还不够：如果最后一个引用仍由协程帧在工作线程释放，问题仍在。

---

## 3. P0：HttpServer 每次请求复制整张回调表

文件：

```text
src/legacy/api/NetworkAPI.cpp
src/legacy/api/NetworkAPI.h
```

### 3.1 回调结构

```cpp
struct HttpServerCallback {
    ScriptEngine*            engine;
    script::Global<Function> func;
    HttpRequestType          type;
    std::string              path;
};
```

`HttpServerCallback` 含 `Global`，因此任何一次复制、移动、销毁都必须考虑引擎作用域。

### 3.2 `ADD_CALLBACK` 参数是引用，但 lambda 按值捕获

```cpp
void ADD_CALLBACK(
    std::shared_ptr<Server> const&                  svr,
    std::multimap<std::string, HttpServerCallback>& callbacks,
    ...
) {
    callbacks.emplace(...);

    auto receiveMethod =
        [engine = EngineScope::currentEngine(), method, callbacks](Request const& req, Response& resp) {
            ...
            keepThis([engine, req, &resp, method, callbacks]() -> CoroTask<> {
                ...
            }).syncLaunch(ThreadPoolExecutor::getDefault());
        };
}
```

两处 `callbacks` 都没有 `&`：

- 外层路由 lambda 复制整张 multimap
- 内层 keepThis 协程再复制一次
- 每个 `HttpServerCallback` 的 `Global` 被复制
- 协程在 **ThreadPoolExecutor 工作线程**结束
- 协程帧销毁时没有 `EngineScope`
- `~pair<string, HttpServerCallback>` → `~Global` → 空引擎 → 崩

这与 10-22、10-26 的栈完全一致：

```text
~Global
~pair<string, HttpServerCallback>
_Tree_val<...>::_Erase_tree_and_orphan
keepThis<lambda at NetworkAPI.cpp:442>
ThreadPoolExecutor
```

### 3.3 性能问题

每次 HTTP 请求都复制整个回调 map：

- 路由越多，复制越贵
- 每个 `Global` 复制都会改引用计数/簿记
- 高频网页轮询会把 CPU 和内存压力放大

这不只是生命周期 bug，也是明确的性能缺陷。

### 3.4 修复

两处都要引用：

```diff
- [engine = EngineScope::currentEngine(), method, callbacks]
+ [engine = EngineScope::currentEngine(), method, &callbacks]
...
- keepThis([engine, req, &resp, method, callbacks]() -> CoroTask<> {
+ keepThis([engine, req, &resp, method, &callbacks]() -> CoroTask<> {
```

注意：

- 生命周期必须保证 `HttpServerClass` / `svr` 覆盖所有在途请求
- `stop()` 后不能再进入新请求
- 不能简单换成 `shared_ptr` 就认为安全：最后一个引用仍可能在工作线程释放，仍没有 `EngineScope`

### 3.5 `HttpServerClass` 的析构顺序

头文件：

```cpp
class HttpServerClass : public ScriptClass {
protected:
    std::shared_ptr<httplib::Server>               svr;
    std::multimap<std::string, HttpServerCallback> callbacks;
    HttpServerCallback errorCallback, exceptionCallback,
                       preRoutingCallback, postRoutingCallback;
};
```

析构：

```cpp
HttpServerClass::~HttpServerClass() { svr->stop(); }
```

问题：

- 析构体只 stop，不清理 `callbacks`
- 成员按声明逆序析构，`callbacks` 先于 `svr`
- `callbacks` 里的 `Global` 可能在引擎已经销毁后析构
- `preRouting/error/exception` 回调同样持有 `Global`
- `svr` 里的路由 lambda 还保存了一份回调表副本

修复建议：

- `stop()` 后等待监听线程退出
- 在 `EngineScope` 内清空 `callbacks` 与四个单回调
- 确保 `Global` 在 QuickJS 运行时仍有效时释放
- 路由 lambda 不拥有 `Global`

---

## 4. P1：HttpServer 监听线程捕获裸 `this`

```cpp
Local<Value> HttpServerClass::listen(Arguments const& args) const {
    std::thread([this, addr, port]() {
        svr->stop();
        svr->listen(addr, port);
    }).detach();
}
```

问题：

- 线程持有裸 `this`
- `HttpServerClass` 销毁后线程可能继续访问 `this->svr`
- `stop()` 不会 join 该线程
- 插件热重载/关服时可能出现 use-after-free

修复：

- 捕获 `std::shared_ptr<httplib::Server>`，不要捕获 `this`
- 记录监听线程，`stop()` 时 join 或等待退出
- 停止后禁止再次访问 `callbacks`/`this`

---

## 5. P1：`network.httpGet/httpPost` 回调也是跨线程 `Global`

`NetworkAPI.cpp` 的 `HttpGet/HttpPost` 用 detached 线程执行请求：

```cpp
script::Global<Function> callbackFunc{args[...]};

auto lambda = [callback{std::move(callbackFunc)}, engine](int status, string const& body) {
    if (invalid) return;
    EngineScope scope(engine);
    NewTimeout(callback.get(), {...}, 1);
};

HttpGet(target, lambda);   // 内部 std::thread(...).detach()
```

析构顺序：

1. `lambda` 内 `EngineScope` 结束
2. 网络线程结束
3. lambda 捕获的 `Global<Function>` 析构
4. 当前线程没有 `EngineScope`
5. 若引擎已销毁，同样触发 `~Global` 崩溃

同类位置：

```text
NetworkClass::httpGet   第 1177 行
NetworkClass::httpPost  第 1225 行
WSClientClass::connectAsync 第 322 行
```

修复方向：

- 不把 `Global` 作为 detached 线程的长期所有权
- 请求完成时把回调登记到引擎任务系统，由引擎侧持有
- 线程退出前在 `EngineScope` 内释放局部 `Global`
- 引擎销毁时取消/清空在途网络回调

---

## 6. P2：WebSocket 监听器

`WSClientClass` 的监听器表：

```cpp
std::list<ListenerListType> listeners[...];
```

`ListenerListType` 含 `script::Global<Function>`。

`initListeners_s`：

```cpp
ws->OnTextReceived([nowList{&listeners[...]} ...](...) {
    keepThis([nowList, engine, msg]() -> CoroTask<> {
        ...
        for (auto& listener : *nowList) {
            listener.func.get().call(...);
        }
    }).launch(ThreadPoolExecutor);
});
```

问题：

- `nowList` 是裸指针，指向 `WSClientClass` 内部 list
- 回调可能在 `WSClientClass` 销毁后运行
- `keepThis` 协程帧不拥有 `listeners`
- 监听器 `Global` 的析构时机由 WebSocket 线程/对象销毁决定
- 引擎卸载时没有统一清理

同类风险，未在现有 5 份 dump 中直接命中，但结构相同。

---

## 7. 同类 `Global` 风险面

LSE 源码中 `script::Global` 出现约 55 处。已确认的 P0 在：

- `TimeTaskSystem.cpp`
- `NetworkAPI.cpp` HttpServer
- `NetworkAPI.cpp` HttpGet/HttpPost

需要继续审计的模块：

| 文件 | 风险 |
| --- | --- |
| `FileSystemAPI.cpp` | 异步文件回调持有 `Global` |
| `GuiAPI.cpp` | 表单/界面回调与引擎生命周期 |
| `PlayerAPI.cpp` | 异步玩家操作回调 |
| `RemoteCallAPI.cpp` | 跨插件回调、引擎卸载 |
| `EventAPI.cpp/h` | 事件监听器 `Global` 的清理顺序 |
| `CommandAPI.cpp` | 命令回调 |
| `LlAPI.cpp` | `onUnload` 回调自身 |
| `WSClientClass` | WebSocket 监听器 / `connectAsync` |

不能因为当前 dump 只命中两个模块，就认为其他 `Global` 都安全。判断标准是：

> 这个 `Global` 是否可能在没有 `EngineScope` 的线程、或在引擎销毁之后被析构？

---

## 8. 堆破坏链路

`mi_malloc` 的两次崩溃（18:15、18:20）不应单独归因到 `player.getNbt()`。

更合理的链路：

```text
~Global 在错误引擎/无线程作用域下释放
  -> QuickJS 堆/簿记结构被破坏
  -> 后续任意分配命中坏堆
  -> mi_malloc 崩溃（表现为 Player::save / getNbt 等无关栈）
```

这是强推断，不是单次 dump 的直接证明，但和 4 次 `~Global` 直接崩溃、同机、同子系统、连续时间线一致。

因此修复顺序必须先修 `Global` 生命周期，再观察 `mi_malloc` 是否消失。

---

## 9. 修复优先级

### 第一优先：NetworkAPI 回调引用捕获

改动小，直接消掉 10-22、18:36 的 4/5 直接崩溃来源，并消除每请求复制整表。

同时处理：

- `HttpServerClass` 析构前清理 `callbacks`
- `listen` 不捕获裸 `this`
- `stop()` 等待监听线程

### 第二优先：TimeTaskSystem 引擎持有任务

改动大，但 19:06 的路径 A 不能靠 scope 修。

要求：

- `TimeTaskData` 由引擎注册表持有
- 引擎卸载时在 `EngineScope` 内清空
- 协程帧不拥有最后的 `Global`

### 第三优先：网络/WS 回调

- `httpGet/httpPost` 回调不在 detached 线程析构 `Global`
- WS 监听器表在引擎卸载时统一清理
- 所有异步回调登记到引擎生命周期管理器

---

## 10. 插件侧规避

在 LSE 修复前：

- 避免 `setTimeout` / `setInterval`，改用 `mc.listen("onTick")` + 计数
- 避免高频 `network.httpGet/httpPost`
- 不要在插件卸载时发起新的网络请求
- 网页 HttpServer 不要在卸载后才销毁

WebBundle 当前：

- `setInterval`：0
- `setTimeout`：4 个短任务（1.5s/5s）
- 下一步把这些短任务改为 `onTick` 计数

---

## 11. 验证清单

1. NetworkAPI 改引用后，连续 HTTP 轮询 30 分钟，不出现 `~HttpServerCallback`。
2. 请求期间停止服务器/卸载插件，不出现 `~Global`。
3. 定时任务改引擎注册表后，`setTimeout` / `setInterval` 在卸载时正常释放。
4. 关服 + 热重载各 20 次，无 `~Global`。
5. 修复后用相同 cdb `!analyze -v` 检查 `FAILURE_BUCKET_ID` 不再命中 `Global`。
6. 使用与 DLL 匹配的 PDB 再确认行号。
7. 观察 `mi_malloc` 二次崩溃是否随 `Global` 修复消失。

---

## 12. PDB 问题

当前 PDB 与线上 DLL 不是同一次构建：

```text
Unable to verify timestamp for legacy-script-engine-quickjs.dll
```

影响：

- 行号可能在 42 / 119 / 161 之间漂移
- 符号名可用，但源码行号不可作为唯一依据
- 修复验证必须使用同一构建产出的 DLL + PDB

---

## 13. 上游问题拆分

建议拆成独立 issue：

1. `TimeTaskSystem`: coroutine frame owns `Global`; engine unload only clears map.
2. `NetworkAPI`: HttpServer request copies callback map with `Global` to thread pool.
3. `HttpServerClass`: callback member destruction outside EngineScope.
4. `HttpServerClass`: detached listen thread captures raw `this`.
5. `NetworkAPI`: httpGet/httpPost callback `Global` destruction on detached network thread.
6. `WSClientClass`: raw listener list pointer + `Global` cleanup.
7. `script::Global`: destructor requires current engine and has no safe no-engine path (design-level hardening).

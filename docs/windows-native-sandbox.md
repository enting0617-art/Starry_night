# Windows 原生 Python 沙盒

星空不再使用 Docker 来运行 AI 生成的 Python。`runtime/sandbox/starry-sandbox.exe` 是一个很小的本机 broker：Node 只把审计通过的源码、固定限制和项目内的临时工作目录通过标准输入交给它；它不接受命令行、shell 字符串或任意程序路径。

## 信任边界

- 主应用永远不在 Windows 宿主机直接执行模型生成的 Python。
- 每次运行都创建新的 `data/sandbox/python/<随机目录>/main.py`；该路径被 Git 忽略。
- Python 子进程在无 network capability 的 Windows AppContainer 中创建，不能访问网络，也不能继承主应用的普通权限。
- helper 仅授权该 AppContainer 读取 Python runtime、修改本次随机工作目录；不会把项目根目录或用户目录授权给它。
- Job Object 强制单进程、256 MB 进程/作业内存上限、50% CPU 硬上限、12 秒执行时间和 broker 关闭即终止全部子进程。
- stdout/stderr 通过受控管道返回，各自最多 1 MB；不会把输出无限积在内存中。

静态检查（文件名、32 KB 源码上限、危险模块与 API 拒绝）只是额外防线，不是安全边界。真正的边界是 AppContainer 与 Job Object。

## 便携打包

发布包须包含：

```text
runtime/sandbox/starry-sandbox.exe
runtime/python/python.exe
```

当前开发环境会临时兼容项目已有 `GPT-SoVITS-v3lora-20250228/runtime/python.exe`，方便本机验证；发布包应把仅用于沙盒的 runtime 放到 `runtime/python/`。最终用户不需要安装 Docker、Python、编译器或管理员组件。

源码在 `native/sandbox-helper/starry-sandbox.cs`。如需在开发机重建可执行文件，运行 `scripts/build-sandbox-helper.bat`；正常用户不需要运行它。

## 故障策略

helper、受限 runtime、AppContainer 或 Job Object 任一项不能建立时，本功能直接拒绝运行并在聊天回复中显示原因；绝不会回退到宿主机运行。此实现面向 Windows 10/11 x64。

# ADR-0004：Provider 原生权限档与新 Session 默认最高权限

- 状态：Accepted
- 日期：2026-07-27
- 适用阶段：P1.1 起
- 替代：ADR-0003 §4 中“默认审批策略永远是询问”和“不能自动允许”的产品默认值

## 背景

DougoOS 同时接入多个 Agent CLI。不同 CLI 对权限的表达并不等价：

- 有的通过启动参数关闭审批或 sandbox；
- 有的通过 ACP mode/config option 切换；
- 有的只请求客户端审批；
- 有的在 Agent 或外部 Gateway 内部直接执行工具，客户端无法保证阻断。

单一的“自动批准”布尔值会掩盖这些差异，也无法说明设置变化是否影响已经运行的
Session。产品决定让可控 Provider 的新 Session 默认使用其最高权限，同时允许用户按
Provider 选择该 CLI 原生支持的档位。

## 决策

### 1. 权限档由 Provider 声明

每个可执行 Provider 发布稳定的权限档 ID、统一语义、风险、应用机制和实际
`permissionEnforcement`。Core 和 Renderer 只能选择 Provider 声明的 ID，不能传入任意
argv、环境变量、ACP mode 或 config option。

统一语义只用于展示和审计，不强迫不同 CLI 假装拥有相同档位：

- `read_only`
- `ask`
- `auto_limited`
- `unrestricted`
- `external`

可控 Provider 的 `defaultPermissionProfileId` 必须指向其声明的最高权限档。OpenClaw
等由进程外全局策略管理的 Provider 使用 `external`，DougoOS 不得为满足默认值而静默
改写其他应用共享的配置。

### 2. 设置是新 Session 默认值

权限偏好按 `providerId` 持久化。创建 Session 时，Core 解析并校验当前偏好，把请求档位、
实际生效档位、应用机制和 enforcement 冻结到 Session 快照。设置变化不修改运行中或
历史 Session。

新安装 Provider 没有偏好记录时使用其最高权限默认值。已保存的档位被新版 Provider
移除时，创建 Session 必须失败并要求用户重新选择，不能静默降级，也不能自动扩大到另一个
权限档。

### 3. 自动允许的边界

只有实际生效档位语义为 `auto_limited` 或 `unrestricted` 时，Registry 才能自动解决 ACP
permission request。自动决定必须绑定当前 Session、Provider、cwd、requestId 和服务端
返回的 optionId，并产生安全摘要审计；不得记录完整命令、文件内容、环境变量或 secrets。

Provider 原生 bypass/yolo 可能不会产生 ACP permission request。UI 必须显示真实
enforcement，不能把 `not_guaranteed` 描述成客户端已提供完整沙箱。

### 4. 启动与协商顺序

启动参数型策略在 spawn 前由 Provider 映射；ACP mode/config 型策略在 `session/new`
返回后、首条 prompt 前校验并应用。Agent 没有发布所需 mode/config 时 Session 创建失败。
任何未知 profile、未知 mode 或无效 option 均 fail closed。

## 备选与取舍

### 所有 Provider 统一两档或三档

这会迫使 Renderer 展示 CLI 实际不支持的能力，或在后台进行不透明降级，因此否决。

### 修改运行中的 Session

启动参数、Agent mode 和审批处理可能已经生效，热切换会造成一次 Session 内权限语义不一致，
因此只允许新 Session 使用新设置。

### 自动管理 OpenClaw Gateway

Gateway 策略可能影响 DougoOS 之外的客户端。除非未来引入隔离 Gateway 和独立 ADR，本期只
展示外部管理状态。

## 影响

- `@dougoos/shared` 增加权限档、Provider 偏好及 Session 权限快照契约。
- Storage 增加 Provider 偏好与 Session 权限字段的只增迁移。
- Provider 端口负责 profile 到 argv/env/ACP action 的受控映射。
- Registry 保留协商结果，并允许受档位约束的自动审批。
- Settings 移除 demo-only 自动批准开关，改为按 Agent 的原生权限选择器。
- ADR-0003 的 interceptor 顺序、超时 fail closed、用户 option 校验和能力边界继续有效。

## 验收

- 每个可控 Provider 无偏好时创建的新 Session 使用声明的最高权限。
- 修改偏好后旧 Session 快照不变，新 Session 使用新档位。
- 未知或已移除 profile 不能启动 Session。
- 自动审批只能发生在允许的语义下，并生成不含敏感内容的审计摘要。
- OpenClaw 不产生任何隐式全局配置写入。
- UI 对 `not_guaranteed` 和 `external` 给出明确说明。

# Alwaysrun

[English](README.en.md) · [架构说明](docs/architecture.md) · [MIT License](LICENSE)

**带有来源记忆、任务调度与独立验收的本机项目助手，由已安装的 Codex 驱动。**

Alwaysrun 保存项目目标、偏好反馈和运行状态，决定下一步值得做什么；Codex 负责模型推理和工程执行。任务完成后，另一轮只读调用核验结果。界面只突出当前一步、接管操作和最近成果。

> 原型项目。默认关闭自动接管。离线测试与单次闭环验证不等于完成整晚稳定性验证。

```mermaid
flowchart LR
    A[本机历史 / 补充资料] --> B[来源索引与偏好记忆]
    B --> C[项目决策与任务队列]
    C --> D[有时限和预算的调度器]
    D --> E[Codex 执行]
    E --> F[独立只读验收]
    F --> G[成果 / 阻塞 / 交接]
    G --> B
```

## 能做什么

- **有来源的记忆**：索引本机 Codex 可见消息、用户补充文本，以及可选的 Mystation 快照和飞书多维表格；保留作者、时间及引用关系。
- **偏好反馈**：确认与拒绝持续保存；冲突判断待复核。通过检索和反馈理解用户，不训练专属模型权重。
- **项目调度**：按已启用项目的优先级推进；受阻后优先准备第一项目的必要条件，再考虑其他项目。无有价值的新工作时待命。
- **执行后验收**：执行使用项目写入权限，验收使用单独的只读调用；同时检查产物或成功命令证据。
- **有限接管**：默认最长 8 小时、24 轮 Codex 调用、100000 输出 tokens；保存任务状态和交接记录。
- **本机界面**：原生 HTML/CSS/JavaScript，Node.js 24 + SQLite，无第三方 Node 运行依赖。

## 快速开始

需要 **Node.js 24+**、已安装并登录的 **Codex CLI**，以及支持所选模型的账号。Codex 的内部聊天库和 app-server 接口可能随版本变化。

```sh
git clone https://github.com/zxyllebron/alwaysrun.git
cd alwaysrun
node scripts/setup.mjs
node src/server.mjs
```

打开 <http://127.0.0.1:8790/>。不需要执行 `npm install`；带 npm 的环境也可使用 `npm run setup` 和 `npm start`。

Windows 也可以双击 `Start Alwaysrun.cmd`；它会初始化配置并隐藏后台服务窗口。双击 `Stop Alwaysrun.cmd` 关闭本程序。macOS/Linux 使用 `npm start`，按 Ctrl+C 停止。

首次安装不携带任何个人资料、偏好或已启用项目。在“项目”添加目标、目录和优先级，或为历史中发现的项目设置目标并启用。可以在“资料”补充上下文，在“更多 → 我的判断”确认或纠正推断。

## 配置

首次启动生成忽略的 `data/config.json`。修改后重启服务；[配置示例](examples/config.example.json) 只含通用值。

| 配置 | 默认与说明 |
| --- | --- |
| `name` | `User`，界面显示名称。 |
| `model` / `effort` | `gpt-6.1-sol` / `xhigh`；可显式修改为账号支持的组合。连接时检查模型目录，不静默降级。 |
| `codexBin` | 安装器优先查找已安装的 Codex。未找到时填写可执行文件的绝对路径，或官方 npm 安装中的 `codex.js` 入口。 |
| `codexHome` | 默认使用 `CODEX_HOME` 或用户目录下的 `.codex`。登录信息在原处使用，不复制认证文件。 |
| `workstationDb` | 默认空，表示关闭可选工作台源。可指向 Mystation 的 `data/workstation.sqlite`。 |
| `night.enabled` | 默认 `false`。开启后按设置的夜间窗口运行。 |
| `night.start` / `hours` | 默认 `23:00`、8 小时；当前定时窗口使用北京时间，小时上限为 9。 |
| `maxTurns` / `maxOutputTokens` | Codex 顶层调用轮数与报告的输出用量上限；不是人民币或完整 token 计费硬上限。 |

初始化也可使用环境变量 `ALWAYSRUN_NAME`、`ALWAYSRUN_PORT`、`ALWAYSRUN_MODEL`、`ALWAYSRUN_EFFORT`、`ALWAYSRUN_CODEX_BIN`、`ALWAYSRUN_CODEX_HOME`、`ALWAYSRUN_WORKSTATION_DB`。已有本地配置优先，`ALWAYSRUN_DATA` 可指定独立的数据目录。本程序不自动加载 `.env`。

手动“开始接管”从点击时计时；定时接管仅在窗口内启动。电脑与服务需保持运行。关闭浏览器不会关闭服务。

## 可选接入

**Mystation**：只读读取工作台已有记录、任务和规划。Gmail 等内容来自工作台已有快照，不代表 Alwaysrun 已连接实时邮箱。仓库名含 feishu 不代表该部署已启用飞书。

**飞书多维表格**：在本机设置 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`，为应用授予目标表格的读取权限；重启后在“资料 → 数据来源”添加真实的 `/base/…` 链接并同步。支持表与记录分页。教程文章、`/wiki/` 页面和个人消息不能由这个适配器直接读取。

## 数据与权限

- 仅监听 `127.0.0.1`，写操作检查来源和随机操作凭证；不作为公网、多用户服务使用。
- 个人配置、索引、聊天、偏好和日志保存在 `data/`，本机核验产物保存在 `artifacts/`，均不提交到 Git。
- 调用模型时，检索出的证据会发送到 Codex 模型服务。本机保存状态不等于离线推理。
- 讨论、规划、偏好分析和验收使用只读模式；执行使用所选项目的 workspace-write 模式。
- 历史聊天与第三方文字是证据，不提供新的行动授权。强制验证及不支持的工具记为阻塞。

本版没有自动付款、代签、最终申请或投稿提交、桌面控制及安全防护绕过能力。详情见 [SECURITY.md](SECURITY.md)。

## 验证与开发

```sh
npm run check
npm test
npm run smoke
```

离线测试覆盖索引对账与回滚、来源角色、偏好反馈、项目优先级、预算、重启恢复和独立验收。干净安装检查使用合成数据，不读取个人资料、不调用模型。

以下检查会连接本机 Codex；`--live` 和 `live-smoke` 会消耗模型配额：

```sh
npm run doctor
npm run doctor -- --live
node scripts/live-smoke.mjs
```

发布前，对已暂存的文件执行：

```sh
npm run audit:public
```

## 项目结构

```text
src/        本机服务、记忆、调度器、Codex 与飞书适配器
static/     无构建步骤的工作台界面
scripts/    初始化、启动、检查和发布审计
tests/     合成夹具与离线回归检查
docs/       架构与设计边界
examples/   不包含个人资料的配置示例
```

`data/`、`artifacts/`、`.protocol/` 与凭据属于本机运行环境，不属于开源发行内容。

## 当前限制

完整 8 小时耐久测试、人民币金额硬上限和大范围真实项目判断质量尚未完成验证。语义去重及偏好关联依赖模型；资料索引不代表每次调用已读完全部历史。内部 Codex 数据库格式、Windows 沙箱及模型可用性需要在使用环境中核验。

## 许可与致谢

[MIT](LICENSE)。界面方向参考 [Mystation](https://github.com/zxyllebron/codex-feishu-workstation)。Codex 集成基于[官方 app-server 接口](https://learn.chatgpt.com/docs/app-server)，Alwaysrun 不附带模型权重或 Codex 登录凭据。

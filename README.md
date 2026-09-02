# 智队搭 (Smart Team Build)

> 一个基于微信小程序云开发的**高校科创竞赛智能组队与技能匹配平台**。
> 面向 iCAN 大学生创新创业大赛场景，让参赛学生从「找赛事 → 找队友 → 管队伍 → 挂指导老师」一站完成。

---

## 1. 项目简介

高校学生参加科创竞赛时普遍面临三大痛点：

- **赛事信息分散**：报名入口多、赛事资讯零散，很难集中获取；
- **组队靠熟人**：缺乏按技能维度科学匹配队友的手段；
- **队伍管理成本高**：成员、赛事、技能需求、指导老师等缺少统一工具。

本项目通过微信小程序提供完整的解决方案：赛事大厅 + AI 赛事详情生成、技能画像 + AI 智能评级、队伍全生命周期管理、智能匹配池、入队申请/邀请审核、**指导老师挂靠**与**个人参赛模式**，并配套管理员后台（赛事管理、管理员授权）。

## 2. 核心功能

### 2.1 赛事模块
- **赛事大厅**：赛事列表展示，支持下拉刷新、按赛事筛选队伍；
- **AI 生成详情**：管理员录入赛事名称/链接后，调用讯飞 MaaS 大模型自动生成赛事简介与含金量分析（管理员权限，防刷模型）；
- 支持海报/详情图片上传、Word 转 HTML（`mammoth`）。

### 2.2 用户与技能画像
- **微信静默登录**：`wxLogin` 自动建档，首次使用引导绑定学号/工号；
- **个人资料**：头像上传（云存储）、昵称/邮箱/简介编辑（邮箱作队友联系方式）；
- **技能管理**：技能字典多选，支持 1~5 星评级；
- **AI 技能评级**：根据个人简介中的技能描述，调用大模型自动评级并入库，前端同步展示星级与颜色（1 银 ~ 5 红）。

### 2.3 队伍模块
- **创建/编辑/删除队伍**：绑定多个参赛赛事（单个赛事最多同队 5 场）、设置人数上限；
- **入队条件**：`0` 无限制 / `1` 需审核 / `2` 仅主动邀请；
- **招募需求**：队长发布所需技能，系统自动计算 `team_missing` 缺失技能；
- **指导老师**：按 uid 搜索教师 → 发送 `subType=advisor` 邀请 → 老师手动同意后挂靠 `teams.advisor`（不占成员名额、不参与匹配与参赛计数）；
- **个人参赛模式**：`isPersonal` 单人队伍（强制 `maxNum=1`、仅主动邀请、不进匹配池），复用队伍完整能力。

### 2.4 申请与邀请中心
- 用户**申请入队**、队长**邀请队员/指导老师**；
- 待处理请求按「用户视角 / 队伍视角 / 队长视角」分别查询；
- `accept` / `reject` 处理，自动联动成员、`tid_list`、匹配池与赛事状态；
- 幂等设计：同类型待处理请求不重复创建。

### 2.5 智能匹配
- 用户/队伍可进入**匹配池**，服务端按「技能需求 + 参赛赛事」双重交集过滤出互补推荐；
- 退出匹配池时联动失效历史 pending 申请，防止幽灵请求。

### 2.6 管理员后台
- **赛事管理**：增删改、AI 生成详情、Word 转 HTML；
- **管理员授权**：授权/取消 `isAdmin`、按 uid/用户名搜索用户。
- 所有敏感操作在**服务端二次校验** `isAdmin`（防绕过前端越权调用）。

### 2.7 个人中心
- 已加入队伍列表、指导关系、联系方式获取（同队校验，手机号永不下发，仅邮箱）。

## 3. 技术架构

| 层级 | 技术选型 | 说明 |
| --- | --- | --- |
| 前端 | 微信原生小程序 + Vant Weapp | Glass-easel 组件框架，分包加载 |
| 状态管理 | 自研 store（`store/`） | 分模块订阅/发布，异步方法劫持自动刷新视图 |
| 后端 | 微信云开发 Serverless | 8 个云函数、约 51 个 action |
| 数据库 | 云数据库 + 云存储 | 6 个集合，数字 ID 关联（uid/tid/cid/sid） |
| AI | 讯飞 MaaS 大模型（`xopdeepseekv32`） | 赛事详情生成、技能评级（非流式，超时 25s） |
| 云环境 | `cloud1-d8gb9nir3847ec081` | 由 `app.js` / `project.config.json` 声明 |

主要依赖：`@vant/weapp`（UI）、`axios`（云函数内调用 AI）、`mammoth`（Word 解析，competitionApi）。

## 4. 项目结构

```
├── app.js / app.json / app.wxss      # 小程序入口（静默登录、云环境初始化）
├── cloudfunctions/                   # 云函数（详见第 5 节）
├── pages/
│   ├── index/                        # 赛事大厅（首页）
│   └── logs/
├── subPackages/                      # 业务分包
│   ├── admin/                        # admin 赛事管理 / admin_users 管理员授权
│   ├── competition/                  # competition_info 竞赛详情
│   ├── joined/                       # joined 我参与的队伍/赛事
│   ├── team/                         # team_list 招募大厅 / team_info 队伍详情 / team_push 队伍表单
│   ├── user/                         # user 个人中心 / profile 编辑资料 / profile_register 绑定 / user_push 用户表单
│   └── images/                       # 本地静态图片
├── store/                            # 全局状态：user / teams / competition / skills / matching_pool
├── miniprogram_npm/                  # npm 组件（@vant/weapp 等）
├── utils/                            # 工具函数
└── project.config.json               # 项目配置（appid、云环境）
```

## 5. 云函数清单

| 云函数 | 职责 | 主要 action |
| --- | --- | --- |
| `userApi` | 用户登录/资料/技能/评级/管理员授权 | `wxLogin` `updateProfile` `setSkillList` `aiRateSkills` `setSkillRatingMap` `getTeachers` `getContact` `searchUsers` `setAdmin` `getByUid` 等 |
| `teamsApi` | 队伍全生命周期 | `create` `getList` `getByTid/Uid/Cid` `addMember` `removeMember` `addAdvisor` `removeAdvisor` `setTeamNeeds` `setCondition` `setMatchStatus` `update` `delete` 等 |
| `requestApi` | 申请/邀请/处理 | `create`（支持 `subType=advisor`）`getByUser` `getByTeam` `getByCaptain` `handle` |
| `matching_poolApi` | 匹配池 | `enterPool` `exitPool` `getMatchList` `getMyPool` |
| `competitionApi` | 赛事管理 + AI 生成 | `getAll` `create` `update` `delete` `aiGenDetail` `wordToHtml` `getFileTempUrl`（写操作需管理员） |
| `getFileUrl` | fileID 批量换临时链接 | — |
| `skill_add` / `skill_getAll` | 技能字典新增 / 查询 | — |

统一返回约定：`{ code, msg, data }`（`0` 成功 / `-99` 未知 action / `-403` 无权限 / `-500` 服务器异常）。

## 6. 数据集合

需在云开发控制台创建以下 **6 个集合**：

| 集合 | 用途 | 关键字段 |
| --- | --- | --- |
| `user` | 用户档案 | `_openid` `userInfo.uid/username/avatar/email/introduction/institute` `role` `skills` `skill_rating` `tid_list` `onGoing_cid` `is_matching` `isAdmin` |
| `teams` | 队伍 | `tid` `name` `cid_list` `leader` `members` `advisor` `condition` `maxNum` `team_needs` `team_missing` `isPersonal` `is_matching` |
| `skills` | 技能字典 | `sid` `name` `desc` |
| `requests` | 申请/邀请 | `type` `subType`（advisor）`tid` `uid` `cid` `skillId` `status` `createTime` |
| `matching_pool` | 匹配池 | `type` `targetId` `match_items` `createTime` |
| `competition` | 赛事 | `cid` `name` `url` `level` `poster` `detailPoster` `detailImageList` `content` `status` `start` `end` |

> 集合权限建议：生产环境按业务配置自定义安全规则；开发阶段可先用「所有用户可读、仅创建者可读写」，核心写操作由云函数以管理端权限完成。

## 7. 快速开始

1. **环境准备**：安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)。
2. **导入项目**：使用本项目 AppID（`project.config.json` 中的 `wxf60da1805ba7ff3e`），勾选「云开发」。
3. **云环境**：创建云环境后，将 `app.js` 中 `wx.cloud.init` 的 `env` 与 `project.config.json` 的 `cloudEnvId` 改为你的环境 ID。
4. **部署云函数**：在 `cloudfunctions` 下对 8 个函数分别右键 →「上传并部署：云端安装依赖」。
5. **创建集合**：按第 6 节创建 6 个集合，并向 `skills` 写入技能字典。
6. **配置 AI 环境变量**（见下节）。
7. **初始化管理员**：将管理员用户文档的 `isAdmin` 字段置为 `true`（或通过 `userApi.setAdmin`）。

## 8. AI 配置

云函数通过**环境变量**读取讯飞 MaaS 密钥，不再硬编码在代码中：

- 云开发控制台 → 云函数 → 依次选择 `competitionApi`、`userApi` → 配置 → 环境变量：
  - `AI_API_KEY`：讯飞控制台生成的 `APIKey:APISecret` 形式密钥（冒号分隔，无需引号）；
  - `AI_MODEL_ID`：模型 ID（如 `xopdeepseekv32`）；
- **配置后必须重新部署对应云函数**，环境变量随部署注入；
- `AI_API_KEY` 未配置时 AI 请求返回 401，`AI_MODEL_ID` 缺失时兜底为 `xopdeepseekv32`。

## 9. 注意事项与已知限制

- **登录态**：`wxLogin` / `updateProfile` / `getContact` 依赖微信 `OPENID`，云端控制台直接测试无效，需从小程序端验证。
- **真实落库**：云函数写操作会直接改动数据库，测试请使用示例数据并及时清理。
- **AI 响应慢**：大模型非流式调用约 10~25 秒，注意云函数超时与前端等待反馈。
- **越权防护**：赛事写操作、管理员授权等敏感 action 均在服务端二次校验 `isAdmin`，云端直调会返回 `-403`，属预期。
- **已知未实现**：`userApi.setMatch`、`userApi.deleteUser` 路由已声明但 service 层未实现，调用返回 `-500`（不影响现有业务）。
- **环境变量**：密钥已迁移至云开发控制台，请勿在代码中提交明文 `AI_API_KEY`。

## 10. 版本记录

| 版本 | 日期 | 里程碑 |
| --- | --- | --- |
| v0.1 | 2026-08-26 | 基础框架 + 8 云函数 + 6 集合；申请/邀请/匹配链路打通 |
| v0.2 | 2026-08-28 | 权限加固（`ensureAdmin`）、AI 输出规整、匹配池联动修复 |
| v0.3 | 2026-08-29 | 指导老师模块、个人参赛模式、赛事状态校验、uid 唯一性校验 |
| v0.4 | 2026-08-30 | 招募大厅过滤、队伍列表空白修复、iOS 真机兼容、资料页交互优化 |

# 智未EHR · 部署指南（WP-36）

## 一、开发/测试环境（本机，已验证）

```bash
# 环境：Node 20+、npm（无需 Docker/PostgreSQL——测试用嵌入式真实 PG16）
npm install                 # 安装全部依赖（npm workspaces）
npm run test -w server      # 服务端 110 用例（自动起嵌入式 PG + 推 schema）
npm run test -w admin-web   # Web 16 用例
npm run test -w mobile-app  # APP 6 用例
npm run dev -w server       # 后端 http://127.0.0.1:3000
npm run dev -w admin-web    # 前端 http://127.0.0.1:5173（/api 已代理到 3000）
npm run dev -w mobile-app   # APP(H5) http://127.0.0.1:5174
```

## 二、生产部署（Docker 路线）

```bash
# 1. 数据库与缓存
docker compose up -d postgres redis
# 2. 配置
cp server/.env.example server/.env   # 改 JWT_SECRET 为强随机串
# 3. 初始化 schema（一次性）
cd server && npx prisma db push && npx prisma generate
# 4. 构建并启动
npm run build -w admin-web && npm run build -w mobile-app
node node_modules/typescript/bin/tsc -p server/tsconfig.json
node server/dist/src/main.js         # 入口在 dist/src/（tsconfig outDir 结构）
```

## 三、Nginx 反代要点

- `/api/` → 127.0.0.1:3000（后端）
- `/` → 前端 dist（admin-web）或 H5 静态目录（mobile-app）
- 开启 HTTPS；`client_max_body_size 20m`（Excel 导入/附件）

## 四、验收对照（当前自动化已覆盖）

服务端 21 套件 110 用例覆盖 PRD 全部 P0 主链路与 UAT 1~13 专项：
认证锁定/多租户隔离/RBAC 越权/审计留痕/组织导入/指标口径窗口/方案校验/
任务状态机/数据填报防倒推/异议复核/自评上级评/汇总公式/强制分布 40002/
申诉面谈闭环/周期关联三模式+缺期折算+修订联动/报告匿名 360/OKR 进度/
悬赏并发 40005+积分幂等+弃单封底/日报封顶加分/日历/PIP/皮肤同步。

压测（NFR-01/02）与定时调度（节点到期自动推进）为上线前待办，
APP 真机打包（HBuilderX 云打包）按 mobile-app 页面迁移 uni-app 后进行。

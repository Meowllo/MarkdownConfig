/**
 * 全项目统一版号的**唯一来源**（发版时只改这一处）。
 *
 * 同号范围：CLI / SDK / Python 库 / VS Code 扩展 / Agent Skill / `SPEC.md`。
 * 为什么单独一个文件：`cli.ts`、读取层、指纹都要用它；版号散在多处必然漂移。
 * 注意 `package.json` 的 `version` 仍要同步改（npm 只认它），这是构建系统约束，不是设计选择。
 */
export const VERSION = "0.6.0";

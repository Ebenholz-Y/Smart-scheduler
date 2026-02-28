# 智能排课系统

基于遗传算法建模的课程调度系统，解决课程、教师、教室三重资源冲突问题，实现高可用、低人工干预的自动化排课。

## 🔧 技术栈
- **后端**：Python 3.9+、Flask、PuLP（ILP 建模库）
- **求解器**：CBC（开源 MILP 求解器）
- **前端**：HTML/CSS/JavaScript（原生）
- **数据库**：MySQL

## 🔧总体架构设计
系统采用前后端分离架构，支持多角色登录、自动排课与交互式调课。

<img width="867" height="386" alt="image" src="https://github.com/user-attachments/assets/555b62d4-650c-4bba-bbc0-11729462a286" />


## 🛠 构建与运行（详参配布与操作）

第一步：安装语言环境基础依赖（环境文件夹）

第二步：创建数据库和用户（推荐非 root 用户）

第三步：准备项目文件

第四步：安装 Node.js 依赖

第五步：初始化数据库表结构 & 导入课程数据

第六步：启动后端服务

第七步：访问系统：http://localhost:3000/login.html


## 📈 核心成果
1.效率提升显著
自动排课可在几分钟内完成
批量处理能力强大
可自行导入课表并导出排课结果excel和pdf

2.冲突检测与避免
实时冲突检测机制
多重约束条件自动满足

3.多目标优化
教室利用率最优化

4.灵活可维护
支持动态调整
实时可视化展示

## 📸 效果截图
原课程表：
<img width="1513" height="664" alt="屏幕截图 2025-12-24 081726" src="https://github.com/user-attachments/assets/9d2b525f-de30-4e80-a7c0-986f9b8d686c" />

排课结果：
<img width="1838" height="909" alt="屏幕截图 2025-12-24 224809" src="https://github.com/user-attachments/assets/82be34f5-5c7f-43be-9f02-fcdcd4a6c7c5" />


# Knowledge Tree

- project: digist
- generated_at: 2026-05-02T17:47:01.704Z

## 关键设计

- reference/ (`readme`)
- 项目参考资料目录管理规范 (`src-20260502-readme`)
  - reference/ 目录用于集中管理项目的只读参考资料，包括开源项目、论文、技术博客等资料，强调与源代码物理分离，大文件建议使用 Git LFS 存储或仅保留链接以优化仓库体积。
- 参考资料目录 (`entity-reference-directory`)
  - 项目的只读参考资料集中存储目录，用于规范参考资料的管理方式，与源代码物理分离，支持开源项目、论文、技术博客等多种资料类型的存放。
- 参考资料管理 (`concept-reference-management`)
  - 参考资料管理是在项目中规范存放和管理外部参考资料的方法，通过建立专门的目录结构、分类组织、版本控制和更新机制，实现技术知识的有效积累和复用，提升团队协作效率。

## 总体设计

- 总体设计/concept (`overall-concept`)
  - 由 2 个关键设计节点抽象而来
- 总体设计/source (`overall-source`)
  - 由 1 个关键设计节点抽象而来
- 总体设计/entity (`overall-entity`)
  - 由 1 个关键设计节点抽象而来

## 一般逻辑

- 这类项目的一般逻辑 (`general-logic-core`)
  - 从多个总体设计层抽象出的通用逻辑骨架
  - 从 source/concept/entity 页面抽取可复用结构
  - 按问题-方法-约束组织知识层次
  - 优先沉淀可被 Agent 复用的设计规则


---
id: department-service
name: DepartmentService
type: concept
context: FULL_TEST
aspects: [domain]
status: draft
updated: 2026-07-11
---

## Описание

Сгруппировано 5 якорей (эвристика по имени/схеме)

## Отношения

| Тип | Понятие | Комментарий |
|---|---|---|
| uses | concept:employee-service | lifted from L1 calls |

## Grounding

| Роль | Цель | Комментарий |
|---|---|---|
| implemented_in | DepartmentService | anchor+resolveGroundingTarget |
| implemented_in | DepartmentService.getAll | anchor+resolveGroundingTarget |
| implemented_in | DepartmentService.update | anchor+resolveGroundingTarget |
| implemented_in | DepartmentService.create | anchor+resolveGroundingTarget |
| implemented_in | DepartmentService.getById | anchor+resolveGroundingTarget |

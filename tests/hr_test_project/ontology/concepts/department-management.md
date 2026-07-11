---
id: department-management
name: Department Management
type: concept
context: FULL_TEST
aspects: [domain, service]
status: draft
updated: 2026-07-11
---

## Описание

Encapsulates department-related services, data retrieval, and statistics.

## Отношения

| Тип | Понятие | Комментарий |
|---|---|---|
| uses | concept:employee-management | lifted from L1 calls |

## Grounding

| Роль | Цель | Комментарий |
|---|---|---|
| implemented_in | DepartmentService | anchor+resolveGroundingTarget |
| implemented_in | DepartmentService.getAll | anchor+resolveGroundingTarget |
| implemented_in | DepartmentService.getById | anchor+resolveGroundingTarget |
| implemented_in | DepartmentService.create | anchor+resolveGroundingTarget |
| implemented_in | DepartmentService.update | anchor+resolveGroundingTarget |
| implemented_in | getDepartmentStats | anchor+resolveGroundingTarget |
| stored_in | hr.departments | anchor+resolveGroundingTarget |
| implemented_in | Department | anchor+resolveGroundingTarget |

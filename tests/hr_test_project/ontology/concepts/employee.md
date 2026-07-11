---
id: employee
name: Сотрудник
type: concept
context: FULL_TEST
aspects: [domain]
status: draft
updated: 2026-07-11
---

## Описание

Основная единица персонала, обладающая навыками и所属 отделом.

## Отношения

| Тип | Понятие | Комментарий |
|---|---|---|

## Grounding

| Роль | Цель | Комментарий |
|---|---|---|
| implemented_in | EmployeeService | anchor+resolveGroundingTarget |
| implemented_in | EmployeeService.constructor | anchor+resolveGroundingTarget |
| implemented_in | EmployeeService.getById | anchor+resolveGroundingTarget |
| implemented_in | EmployeeService.update | anchor+resolveGroundingTarget |
| implemented_in | EmployeeService.create | anchor+resolveGroundingTarget |

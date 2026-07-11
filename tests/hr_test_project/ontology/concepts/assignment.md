---
id: assignment
name: Назначение
type: concept
context: FULL_TEST
aspects: [domain]
status: draft
updated: 2026-07-11
---

## Описание

Назначение сотрудника на проект или рабочую задачу.

## Отношения

| Тип | Понятие | Комментарий |
|---|---|---|
| uses | concept:employee | Назначен сотрудник |
| uses | concept:project | В рамках проекта |

## Grounding

| Роль | Цель | Комментарий |
|---|---|---|
| stored_in | hr.assignments | anchor+resolveGroundingTarget |

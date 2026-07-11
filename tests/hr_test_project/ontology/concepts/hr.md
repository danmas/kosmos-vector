---
id: hr
name: hr
type: concept
context: FULL_TEST
aspects: [domain]
status: draft
updated: 2026-07-11
---

## Описание

Сгруппировано 2 якорей (эвристика по имени/схеме)

## Отношения

| Тип | Понятие | Комментарий |
|---|---|---|
| related_to | concept:employees | lifted from L1 reads_from |
| related_to | concept:employee-skills | lifted from L1 reads_from |
| related_to | concept:skills | lifted from L1 reads_from |

## Grounding

| Роль | Цель | Комментарий |
|---|---|---|
| implemented_in | hr.get_employee_skills | anchor+resolveGroundingTarget |
| implemented_in | hr.get_department_employees | anchor+resolveGroundingTarget |

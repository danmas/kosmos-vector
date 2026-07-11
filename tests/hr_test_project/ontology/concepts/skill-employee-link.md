---
id: skill-employee-link
name: Назначение навыков
type: concept
context: FULL_TEST
aspects: [domain, service]
status: draft
updated: 2026-07-11
---

## Описание

Добавление навыков сотрудникам.

## Отношения

| Тип | Понятие | Комментарий |
|---|---|---|
| uses | concept:employee-ops-service | для обновления профиля |

## Grounding

| Роль | Цель | Комментарий |
|---|---|---|
| implemented_in | SkillService.addSkillToEmployee | anchor+resolveGroundingTarget |
| stored_in | hr.employee_skills | anchor+resolveGroundingTarget |
| implemented_in | SkillService.getById | anchor+resolveGroundingTarget |

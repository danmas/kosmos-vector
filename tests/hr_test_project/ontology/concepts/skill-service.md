---
id: skill-service
name: SkillService
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
| uses | concept:validate-skill-id | lifted from L1 calls |
| uses | concept:validate-skill-level | lifted from L1 calls |

## Grounding

| Роль | Цель | Комментарий |
|---|---|---|
| implemented_in | SkillService | anchor+resolveGroundingTarget |
| implemented_in | SkillService.addSkillToEmployee | anchor+resolveGroundingTarget |
| implemented_in | SkillService.getById | anchor+resolveGroundingTarget |
| implemented_in | SkillService.__construct | anchor+resolveGroundingTarget |
| implemented_in | SkillService.getAllSkills | anchor+resolveGroundingTarget |

---
id: skill-management
name: Skill Management
type: concept
context: FULL_TEST
aspects: [domain, service]
status: draft
updated: 2026-07-11
---

## Описание

Covers skill services, skill assignment to employees, and skill-related validation/formatting.

## Отношения

| Тип | Понятие | Комментарий |
|---|---|---|

## Grounding

| Роль | Цель | Комментарий |
|---|---|---|
| implemented_in | SkillService | anchor+resolveGroundingTarget |
| implemented_in | SkillService.addSkillToEmployee | anchor+resolveGroundingTarget |
| implemented_in | SkillService.getById | anchor+resolveGroundingTarget |
| implemented_in | SkillService.__construct | anchor+resolveGroundingTarget |
| implemented_in | SkillService.getAllSkills | anchor+resolveGroundingTarget |
| implemented_in | validateSkillId | anchor+resolveGroundingTarget |
| implemented_in | validateSkillLevel | anchor+resolveGroundingTarget |
| implemented_in | formatSkillData | anchor+resolveGroundingTarget |
| stored_in | hr.skills | anchor+resolveGroundingTarget |
| implemented_in | SkillServiceInterface | anchor+resolveGroundingTarget |

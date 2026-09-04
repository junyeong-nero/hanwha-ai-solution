# 소개·제출 문서 정리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 문제 정의·기획 배경을 하나의 `introduction.md`로 통합하고, 공개 제출 페이지에서 확인한 제출 요구사항과 평가 기준을 `docs/`에 재사용 가능한 가이드로 정리한다.

**Architecture:** 기존 `background.md`와 `overview.md`의 근거·기획 내용을 주제별 흐름(문제→필요성→해결→기대효과)으로 재배열한다. 제출 페이지의 공개 API 설정·공개 상태·동일한 과제 안내 PDF를 근거로 별도 `submission-guide.md`를 작성하고, README와 기능 명세의 문서 링크를 통합 문서 기준으로 갱신한다.

**Tech Stack:** Markdown, PowerShell HTTP read-only 확인, Node.js 테스트

**Spec:** `AGENTS.md`, `docs/features.md`, 제출 페이지 `https://hanwha-newhire-ai-hub.popolong.workers.dev/`

## Global Constraints

- UI·문서·주석·커밋 메시지는 한국어로 작성한다.
- 기존 기능 명세의 SSOT인 `docs/features.md` 내용은 변경하지 않고 링크만 통합 문서로 갱신한다.
- 저장소의 안내 PDF와 폰트는 수정·삭제하지 않는다.
- 관리자 인증이 필요한 개별 제출물 원문·첨부는 추측하거나 수집하지 않는다.
- 문서 변경 후 `node --test tests/*.mjs`를 실행하고 결과를 확인한다.

### Task 1: 소개 문서 통합

**Files:**
- Create: `docs/introduction.md`
- Modify: `README.md`
- Modify: `docs/features.md`

- [x] **Step 1: 배경과 개요를 문제-해결-효과 흐름으로 재작성한다.**
- [x] **Step 2: 기존 문서 링크를 `introduction.md` 기준으로 갱신한다.**
- [x] **Step 3: 제목·목차·문서 내부 링크를 점검한다.**

### Task 2: 제출 페이지 가이드 정리

**Files:**
- Create: `docs/submission-guide.md`

- [x] **Step 1: 공개 설정에서 제출 방식·필수 산출물·용량·마감 정보를 기록한다.**
- [x] **Step 2: 공개 과제 안내 PDF의 5개 주제와 100점 평가표를 요약한다.**
- [x] **Step 3: 공개 제출 현황과 인증 제한을 명시해 재현 가능한 확인 시점을 남긴다.**

### Task 3: 검증 및 전달

**Files:**
- No additional files

- [x] **Step 1: Markdown 링크와 한국어 인코딩을 확인한다.**
- [x] **Step 2: `node --test tests/*.mjs`를 실행한다.**
- [ ] **Step 3: 변경을 한국어 커밋으로 기록하고 PR을 생성한다.**

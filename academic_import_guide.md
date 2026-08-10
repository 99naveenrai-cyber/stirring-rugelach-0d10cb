# 📘 IdeaKDC Academic Content Import Guide

This document defines the structured schema format for importing externally prepared academic content into **betalaunch.ideakdc.in**.

---

## 📋 JSON Schema Overview

Each content item represents a chapter payload containing study materials, notes, questions, MCQs, formulas, and FAQs.

### Required Fields:
- `classId` *(string)*: `"5"` through `"12"`
- `subject` *(string)*: e.g. `"Science"`, `"Mathematics"`, `"Physics"`, `"Chemistry"`
- `chapterTitle` *(string)*: Name of the chapter (e.g. `"Light – Reflection and Refraction"`)

### Optional Fields:
- `stream` *(string | null)*: `"science"`, `"commerce"`, `"humanities"`, or `null` for Classes 5–10
- `introduction` *(string)*: Chapter introduction summary
- `learningObjectives` *(array of strings)*: Core learning goals
- `keyConcepts` *(array of strings)*: Important conceptual points
- `notes` *(object)*:
  - `handwrittenNotesUrl` *(string)*: PDF or image URL
  - `summary` *(string)*: Quick key notes summary
- `mcqs` *(array of objects)*:
  - `question` *(string)*: Question text
  - `options` *(array of strings)*: Must contain at least 2 choices
  - `correct` *(number)*: 0-indexed correct option
  - `explanation` *(string)*: Answer explanation
- `formulas` *(array of objects)*:
  - `name` *(string)*: Formula title (e.g. `"Mirror Formula"`)
  - `expression` *(string)*: e.g. `"1/f = 1/v + 1/u"`
  - `description` *(string)*: Variable explanations
- `faqs` *(array of objects)*:
  - `question` *(string)*
  - `answer` *(string)*

---

## 📝 Example Import Payload (`academic_content_import_sample.json`)

```json
[
  {
    "classId": "10",
    "stream": null,
    "subject": "Science",
    "chapterTitle": "Light – Reflection and Refraction",
    "introduction": "Light is a form of energy that enables us to see objects.",
    "learningObjectives": [
      "Understand laws of reflection",
      "Apply spherical mirror formulas",
      "Calculate refractive index"
    ],
    "notes": {
      "summary": "Reflection involves bouncing of light off a polished surface. Refraction is bending of light across media."
    },
    "mcqs": [
      {
        "question": "Focal length of a concave mirror of radius of curvature 20 cm is:",
        "options": ["10 cm", "20 cm", "40 cm", "5 cm"],
        "correct": 0,
        "explanation": "f = R/2 = 20/2 = 10 cm."
      }
    ],
    "formulas": [
      {
        "name": "Mirror Formula",
        "expression": "1/f = 1/v + 1/u",
        "description": "f = focal length, v = image distance, u = object distance"
      }
    ],
    "faqs": [
      {
        "question": "What is refraction of light?",
        "answer": "The change in direction of light when passing obliquely from one medium to another."
      }
    ]
  }
]
```

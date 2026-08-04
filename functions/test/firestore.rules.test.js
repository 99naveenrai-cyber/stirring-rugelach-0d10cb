"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const projectId = process.env.GCLOUD_PROJECT || "ideakdc-rules-test";
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const baseUrl = `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents`;
const timestamp = "2026-07-28T00:00:00.000Z";
let studentToken;
let otherStudentToken;
let adminToken;
let studentUid;
let otherStudentUid;
let adminUid;

function encodeValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === "number") return { doubleValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeValue) } };
  }
  if (value && value.__timestamp) return { timestampValue: value.__timestamp };
  if (value && typeof value === "object") {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value).map(([key, nested]) => [key, encodeValue(nested)])
        )
      }
    };
  }
  throw new Error(`Unsupported test value: ${typeof value}`);
}

function encodeDocument(data) {
  return {
    fields: Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, encodeValue(value)])
    )
  };
}

async function createAuthUser(email) {
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password: "Test-password-123!",
        returnSecureToken: true
      })
    }
  );
  const result = await response.json();
  if (!response.ok) throw new Error(`Auth emulator setup failed: ${result.error?.message || response.status}`);
  return { token: result.idToken, uid: result.localId };
}

function documentUrl(pathName, updateFields = []) {
  const url = new URL(`${baseUrl}/${pathName.split("/").map(encodeURIComponent).join("/")}`);
  updateFields.forEach((field) => url.searchParams.append("updateMask.fieldPaths", field));
  return url;
}

async function writeDocument(pathName, data, token, updateFields = []) {
  return fetch(documentUrl(pathName, updateFields), {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(encodeDocument(data))
  });
}

async function readDocument(pathName, token) {
  return fetch(documentUrl(pathName), {
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });
}

async function expectAllowed(responsePromise) {
  const response = await responsePromise;
  const body = await response.text();
  assert.ok(response.ok, `Expected allowed request, received ${response.status}: ${body}`);
}

async function expectDenied(responsePromise) {
  const response = await responsePromise;
  const body = await response.text();
  assert.equal(response.status, 403, `Expected permission denied, received ${response.status}: ${body}`);
}

async function seed(pathName, data) {
  await expectAllowed(writeDocument(pathName, data, "owner"));
}

test.before(async () => {
  const student = await createAuthUser("student-a@example.com");
  const otherStudent = await createAuthUser("student-b@example.com");
  const admin = await createAuthUser("99naveenrai@gmail.com");
  studentToken = student.token;
  studentUid = student.uid;
  otherStudentToken = otherStudent.token;
  otherStudentUid = otherStudent.uid;
  adminToken = admin.token;
  adminUid = admin.uid;
});

test("students can create and update only their own allowed profile fields", async () => {
  await expectAllowed(writeDocument(`users/${studentUid}`, {
    name: "आरव",
    email: "student-a@example.com",
    classNum: "11",
    stream: "Science",
    state: "Bihar",
    mobile: "9876543210",
    phone: "9876543210",
    registrationSource: "conversation",
    role: "student",
    createdAt: { __timestamp: timestamp },
    updatedAt: { __timestamp: timestamp }
  }, studentToken));
  await expectAllowed(writeDocument(`users/${studentUid}`, {
    name: "Aarav",
    updatedAt: { __timestamp: timestamp }
  }, studentToken, ["name", "updatedAt"]));
  await expectDenied(writeDocument(`users/${otherStudentUid}`, { name: "Other" }, studentToken));
  await expectDenied(writeDocument(`users/${studentUid}`, { role: "admin" }, studentToken, ["role"]));
  await expectDenied(writeDocument(`users/${studentUid}`, { isAdmin: true }, studentToken, ["isAdmin"]));
  await expectAllowed(readDocument(`users/${studentUid}`, studentToken));
  await expectDenied(readDocument(`users/${studentUid}`, otherStudentToken));
});

test("students cannot create or modify purchase records", async () => {
  await expectDenied(writeDocument(`users/${studentUid}/purchases/course-1`, {
    access: true
  }, studentToken));
  await expectDenied(writeDocument("purchases/fake-purchase", {
    userId: studentUid,
    accessGranted: true
  }, studentToken));
  await expectDenied(writeDocument("paymentOrders/fake-order", {
    status: "paid"
  }, studentToken));
});

test("enrolment writes reject unexpected fields and preserve valid pending creation", async () => {
  await expectAllowed(writeDocument("enrollments/student-pending", {
    userId: studentUid,
    userName: "आरव",
    userEmail: "student-a@example.com",
    userPhone: "9876543210",
    courseId: "course-1",
    courseName: "Physics",
    status: "pending",
    submittedAt: { __timestamp: timestamp }
  }, studentToken));
  await expectDenied(writeDocument("enrollments/forged", {
    userId: "student-a",
    courseId: "course-1",
    status: "approved",
    access: true
  }, studentToken));
});

test("students and anonymous users cannot modify courses or quiz documents", async () => {
  await expectDenied(writeDocument("content/lesson-1", { title: "Changed" }, studentToken));
  await expectDenied(writeDocument("content/lesson-1/quizzes/separate", {
    questions: []
  }, studentToken));
  await expectDenied(writeDocument("content/lesson-1", { title: "Changed" }, ""));
  await expectDenied(writeDocument("users/anonymous", { role: "admin" }, ""));
});

test("admin can write a validated separate quiz and invalid fields are rejected", async () => {
  await seed("content/lesson-1", { title: "Lesson 1" });
  const quiz = {
    version: 1,
    title: "Lesson Quiz",
    questions: [
      {
        id: 1,
        question: { en: "Question?", hi: "प्रश्न?" },
        options: [
          { id: "A", en: "One", hi: "एक" },
          { id: "B", en: "Two", hi: "दो" }
        ],
        correctOption: "A"
      }
    ],
    courseId: "course-1",
    lessonId: "lesson-1",
    ownerUid: adminUid,
    published: true,
    updatedAt: { __timestamp: timestamp }
  };
  await expectAllowed(writeDocument("content/lesson-1/quizzes/separate", quiz, adminToken));
  await expectAllowed(readDocument("content/lesson-1/quizzes/separate", adminToken));
  await expectDenied(writeDocument("content/lesson-1/quizzes/separate", {
    unexpectedAnswerExport: true,
    updatedAt: { __timestamp: timestamp }
  }, adminToken, ["unexpectedAnswerExport", "updatedAt"]));
});

test("referral members can read only their own profile and cannot write financial fields", async () => {
  await seed(`referralMembers/${studentUid}`, {
    uid: studentUid,
    name: "Aarav",
    upiId: "aarav@upi",
    referralCode: "ABCD234567",
    status: "active",
    pendingPaise: 2500
  });
  await seed(`referralMembers/${otherStudentUid}`, {
    uid: otherStudentUid,
    name: "Meera",
    upiId: "meera@upi",
    referralCode: "EFGH234567",
    status: "active"
  });
  await expectAllowed(readDocument(`referralMembers/${studentUid}`, studentToken));
  await expectDenied(readDocument(`referralMembers/${otherStudentUid}`, studentToken));
  await expectDenied(writeDocument(`referralMembers/${studentUid}`, { pendingPaise: 999999 }, studentToken, ["pendingPaise"]));
  await expectDenied(writeDocument(`referralMembers/${studentUid}`, { status: "active" }, studentToken, ["status"]));
  await expectAllowed(readDocument(`referralMembers/${studentUid}`, adminToken));
});

test("students cannot forge referral attribution, commissions, payouts or settings", async () => {
  await expectDenied(writeDocument(`referralAttributions/${studentUid}`, {
    referredUid: studentUid,
    referrerUid: otherStudentUid,
    referralCode: "EFGH234567",
    status: "active"
  }, studentToken));
  await expectDenied(writeDocument("referralCommissions/fake", {
    referrerUid: studentUid,
    commissionAmountPaise: 50000,
    status: "paid"
  }, studentToken));
  await expectDenied(writeDocument("referralPayouts/fake", {
    referrerUid: studentUid,
    amountPaise: 50000,
    status: "paid"
  }, studentToken));
  await expectDenied(writeDocument("referralCodes/FAKE234567", {
    ownerUid: studentUid,
    status: "active"
  }, studentToken));
  await expectDenied(writeDocument("systemConfig/referrals", {
    enabled: true,
    percentageBps: 5000
  }, studentToken));
});

test("referral financial records are not readable by students", async () => {
  await seed("referralCommissions/commission-1", {
    referrerUid: studentUid,
    commissionAmountPaise: 2500,
    status: "pending"
  });
  await seed("referralPayouts/payout-1", {
    referrerUid: studentUid,
    amountPaise: 2500,
    status: "paid"
  });
  await expectDenied(readDocument("referralCommissions/commission-1", studentToken));
  await expectDenied(readDocument("referralPayouts/payout-1", studentToken));
  await expectAllowed(readDocument("referralCommissions/commission-1", adminToken));
  await expectAllowed(readDocument("referralPayouts/payout-1", adminToken));
});

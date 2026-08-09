"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const pages = require(path.join(root, "academic-pages.js"));
const curriculumSource = fs.readFileSync(path.join(root, "curriculum-access.js"), "utf8");
const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
const firebaseConfig = JSON.parse(fs.readFileSync(path.join(root, "firebase.json"), "utf8"));

function curriculumFor(data) {
  const context = vm.createContext({ window: { NCERT_CURRICULUM_2026_27: data } });
  new vm.Script(curriculumSource).runInContext(context);
  return context.window.IdeaKDCCurriculum;
}

const curriculum = curriculumFor({
  "10": {
    science: ["Ch 1: Chemical Reactions", "Ch 9: Light - Reflection and Refraction"],
    mathematics: ["Ch 1: Real Numbers"]
  },
  "11": {
    "science-physics": ["Ch 1: Units and Measurements"],
    "commerce-accountancy": ["Ch 1: Introduction to Accounting"]
  }
});

test("academic route parser supports class, subject, chapter and resource URLs", () => {
  assert.deepEqual(pages.parseAcademicPath("/class-10/"), {
    classId: "10", subjectId: "", chapterId: "", resourceType: "", kind: "class"
  });
  assert.equal(pages.parseAcademicPath("/class-10/science/").kind, "subject");
  assert.equal(pages.parseAcademicPath("/class-10/science/light-reflection-and-refraction/").kind, "chapter");
  assert.equal(pages.parseAcademicPath("/class-10/science/light-reflection-and-refraction/mcq/").kind, "resource");
  assert.equal(pages.parseAcademicPath("/class-10/science/light/unknown-resource/"), null);
  assert.equal(pages.parseAcademicPath("/admin.html"), null);
});

test("page model resolves actual curriculum fields and creates unique metadata", () => {
  const subjectRoute = pages.parseAcademicPath("/class-10/science/");
  const chapterRoute = pages.parseAcademicPath("/class-10/science/light-reflection-and-refraction/");
  const subject = pages.createPageModel(subjectRoute, curriculum);
  const chapter = pages.createPageModel(chapterRoute, curriculum, [{
    id: "physics-course", classNum: "10", subject: "Science", chapter: "Light Reflection and Refraction", name: "Light Course"
  }]);
  assert.equal(subject.found, true);
  assert.equal(subject.chapters.length, 2);
  assert.equal(chapter.found, true);
  assert.equal(chapter.chapterTitle, "Light - Reflection and Refraction");
  assert.equal(chapter.relatedCourses[0].id, "physics-course");
  assert.notEqual(subject.title, chapter.title);
  assert.equal(chapter.canonical, "https://betalaunch.ideakdc.in/class-10/science/light-reflection-and-refraction/");
  assert.deepEqual(chapter.breadcrumbs.map(item => item.label), ["Home", "Class 10", "Science", "Light - Reflection and Refraction"]);
});

test("senior-secondary subjects resolve through their existing stream data", () => {
  const physics = pages.createPageModel(pages.parseAcademicPath("/class-11/physics/"), curriculum);
  const accountancy = pages.createPageModel(pages.parseAcademicPath("/class-11/accountancy/"), curriculum);
  const classPage = pages.createPageModel(pages.parseAcademicPath("/class-11/"), curriculum);
  assert.equal(physics.subject.streamId, "science");
  assert.equal(accountancy.subject.streamId, "commerce");
  assert.deepEqual(classPage.subjects.map(subject => subject.id), ["physics", "accountancy"]);
});

test("empty resource templates remain noindex until real content exists", () => {
  const route = pages.parseAcademicPath("/class-10/science/light-reflection-and-refraction/notes/");
  const empty = pages.createPageModel(route, curriculum);
  const published = pages.createPageModel(route, curriculum, [], {
    "10/science/light-reflection-and-refraction/notes": { content: "Original notes" }
  });
  assert.equal(empty.indexable, false);
  assert.equal(empty.resourceAvailable, false);
  assert.equal(published.indexable, true);
  assert.equal(published.resourceAvailable, true);
});

test("academic template is wired without changing course access or adding data writes", () => {
  assert.match(indexSource, /id="page-academic"/);
  assert.match(indexSource, /handleAcademicRouteFromUrl/);
  assert.match(indexSource, /if \(hasAcademicRoute\) await handleAcademicRouteFromUrl\(\{ initial: true \}\);\s*await Promise\.all\(\[profilePromise, loadCourses\(\)\]\)/);
  assert.match(indexSource, /application\/ld\+json/);
  assert.match(indexSource, /window\.openCourse\(courseButton\.getAttribute/);
  assert.match(indexSource, /getCourseAccess\(course\.id, course\)/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, "academic-pages.js"), "utf8"), /(?:setDoc|addDoc|updateDoc|deleteDoc|httpsCallable)/);
});

test("Hosting rewrites only academic class routes to the existing app shell", () => {
  assert.deepEqual(firebaseConfig.hosting.rewrites, [{ source: "/class-**", destination: "/index.html" }]);
});

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");

const checks = [
  [app.includes('activeSection: "members"'), "관리자 회원 관리 기본 소메뉴가 없습니다."],
  [app.includes('data-people-section="${tab.id}"'), "관리자 관리 항목 전환 버튼이 없습니다."],
  [app.includes('activeSection === "clients" ? clientPanel'), "선택한 관리 항목만 표시하는 분기 처리가 없습니다."],
  [app.includes('directoryToolbarMarkup("member"'), "회원 데이터베이스 검색·정렬 도구가 없습니다."],
  [app.includes('directoryPaginationMarkup("member"'), "회원 데이터베이스 페이지 분할이 없습니다."],
  [app.includes("data-caregiver-carousel-track"), "홈페이지 관리사 가로 목록이 없습니다."],
  [app.includes('data-caregiver-carousel="-1"') && app.includes('data-caregiver-carousel="1"'), "관리사 이전·다음 탐색 버튼이 없습니다."],
  [app.includes("track.scrollBy"), "관리사 가로 탐색 동작이 연결되지 않았습니다."],
  [styles.includes("scroll-snap-type: inline mandatory"), "가로 카드 스냅 스타일이 없습니다."],
  [styles.includes("grid-auto-columns: clamp(300px, 33vw, 390px)"), "데스크톱 관리사 카드 폭이 반응형이 아닙니다."],
  [styles.includes("grid-auto-columns: minmax(278px, 86vw)"), "모바일 관리사 카드 폭이 반응형이 아닙니다."],
  [styles.includes(".people-section-tabs"), "관리자 소메뉴 스타일이 없습니다."],
];

const failures = checks.filter(([condition]) => !condition).map(([, message]) => message);
if (failures.length) {
  console.error(failures.map((message) => `- ${message}`).join("\n"));
  process.exit(1);
}

console.log(`Interface efficiency checks passed (${checks.length}/${checks.length}).`);

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
  [app.includes('serviceType === "BABYSITTING" ? "is-babysitting" : "is-postpartum"'), "서비스별 빠른 기록 2줄 배치 구분이 없습니다."],
  [styles.includes("grid-template-columns: repeat(5, minmax(0, 1fr))"), "산후조리 빠른 기록이 5개씩 2줄로 배치되지 않습니다."],
  [styles.includes(".instant-record-scroll.is-babysitting") && styles.includes("grid-template-columns: repeat(4, minmax(0, 1fr))"), "베이비시팅 빠른 기록이 4개씩 2줄로 배치되지 않습니다."],
  [!app.includes('{ id: "caregiving", label: "케어기빙 현황"'), "관리사 화면에 제거한 케어기빙 현황 메뉴가 다시 노출됩니다."],
  [!app.includes("function caregiverCaregivingHub()"), "제거한 관리사 케어기빙 대시보드가 코드에 남아 있습니다."],
  [app.includes('caregiver: { postpartum: () => caregiverServiceWorkspace("POSTPARTUM")'), "관리사 기본 작업공간 경로가 산후조리 화면으로 연결되지 않습니다."],
  [app.includes("caregiverRetrospectiveReportEntryMarkup()"), "지난 근무 리포트 보완 기능이 케어 리포트 화면에 유지되지 않았습니다."],
];

const failures = checks.filter(([condition]) => !condition).map(([, message]) => message);
if (failures.length) {
  console.error(failures.map((message) => `- ${message}`).join("\n"));
  process.exit(1);
}

console.log(`Interface efficiency checks passed (${checks.length}/${checks.length}).`);

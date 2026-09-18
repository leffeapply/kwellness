import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, cloud, migration, settlementMigration] = await Promise.all([
  readFile(path.join(root, "app.js"), "utf8"),
  readFile(path.join(root, "cloud-data.js"), "utf8"),
  readFile(path.join(root, "supabase/migrations/037_finance_and_care_record_corrections.sql"), "utf8"),
  readFile(path.join(root, "supabase/migrations/038_shift_reports_and_discounted_settlement.sql"), "utf8"),
]);

const checks = [
  ["legacy service totals are resolved server-side", migration.includes("service_request_expected_total") && migration.includes("resolved_service_total")],
  ["balance receipt function uses the resolved total", migration.includes("expected_total := public.service_request_expected_total(request_row.id)")],
  ["babysitting meals use one unified label", app.includes('name="mealType" value="식사"') && !app.includes('<option>아침</option>')],
  ["activity memo is optional", app.includes("메모를 입력하지 않아도 선택한 이벤트 구분만으로 저장할 수 있습니다.") && !app.includes('id="sitter-note-text" name="text" placeholder="무엇을 했는지')],
  ["feeding volume supports ml and oz with automatic dual display", app.includes('data-unit-measurement="volume"') && app.includes('value="oz"') && app.includes("formatDualVolume")],
  ["temperature supports celsius and fahrenheit with automatic dual display", app.includes('data-unit-measurement="temperature"') && app.includes('value="f"') && app.includes("formatDualTemperature")],
  ["bath water temperature supports celsius and fahrenheit", app.includes('data-unit-measurement="water-temperature"') && app.includes("data.waterTemperature = celsiusFrom(data.inputValue, data.inputUnit)")],
  ["weight supports kilograms and pounds with automatic dual display", app.includes('data-unit-measurement="weight"') && app.includes('value="lb"') && app.includes("formatDualWeight")],
  ["care measurements retain normalized values and original input units", app.includes("data.amount = volumeToMl(data.inputValue, data.inputUnit)") && app.includes("data.value = celsiusFrom(data.inputValue, data.inputUnit)") && app.includes("data.value = kilogramsFrom(data.inputValue, data.inputUnit)")],
  ["new records refresh to the current device time", app.includes("requestAnimationFrame(() => setCareRecordTimeToNow")],
  ["care records expose edit controls", app.includes('data-edit-care-event="${event.id}"') && app.includes("openCareEventEditModal")],
  ["care record edits call a protected RPC", cloud.includes('supabase.rpc("update_care_event"') && migration.includes("create or replace function public.update_care_event")],
  ["care record corrections retain an audit trail", migration.includes("CORRECT_CARE_EVENT") && migration.includes("before_payload") && migration.includes("after_payload")],
  ["completed-visit records may be corrected", migration.includes("if tg_op in ('INSERT', 'DELETE') and session_row.status <> 'IN_PROGRESS'")],
  ["pre-shift safety checks save atomically", cloud.includes('supabase.rpc("save_care_shift_checklist"') && settlementMigration.includes("save_care_shift_checklist") && app.includes("안전 체크 한 번에 저장")],
  ["checked safety items cannot be unchecked accidentally", app.includes('checkbox.disabled = true') && app.includes('checkbox.closest("label")?.classList.add("is-checked")')],
  ["balance payment hash resolves pgcrypto from extensions", settlementMigration.includes("extensions.digest") && settlementMigration.includes("record_service_balance_payment")],
  ["owner discount is enforced and audited server-side", settlementMigration.includes("Only an owner can approve a service discount") && settlementMigration.includes("APPLY_OWNER_SERVICE_DISCOUNT")],
  ["discount settlement is used by the client", cloud.includes('supabase.rpc("settle_service_balance_payment"') && app.includes("오너 할인 적용")],
  ["refund RPC response is normalized and verified", settlementMigration.includes("alter function public.record_service_refund") && cloud.includes('supabase.rpc("record_service_refund"') && cloud.includes("Array.isArray(response) ? response[0] : response") && cloud.includes('saved.status !== "COMPLETED"')],
  ["saved refunds reconcile into the visible ledger immediately", app.includes("state.refundTransactions.some((item) => item.id === savedRefund.id)") && app.includes("refreshedRequest.refundTransactions")],
  ["reports show caregiver assignment history", app.includes("objectiveReportCaregiverHistoryMarkup") && app.includes("서비스 중 관리사 변경") && cloud.includes("contractId: assignment.contract_id")],
];

const failures = checks.filter(([, passed]) => !passed);
if (failures.length) {
  failures.forEach(([label]) => console.error(`FAIL: ${label}`));
  process.exitCode = 1;
} else {
  console.log(`Finance and care-record checks passed (${checks.length}/${checks.length}).`);
}

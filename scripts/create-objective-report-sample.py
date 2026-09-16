from __future__ import annotations

import argparse
from pathlib import Path

from reportlab.graphics.shapes import Drawing, Line, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


GREEN = colors.HexColor("#214D3B")
GREEN_2 = colors.HexColor("#2B6C63")
MINT = colors.HexColor("#EAF3EE")
CREAM = colors.HexColor("#FBF8F1")
CORAL = colors.HexColor("#D88F73")
INK = colors.HexColor("#173A2D")
SOFT = colors.HexColor("#60776D")
LINE = colors.HexColor("#D8E3DD")


def register_fonts() -> tuple[str, str]:
    candidates = [
        (Path(r"C:\Windows\Fonts\malgun.ttf"), Path(r"C:\Windows\Fonts\malgunbd.ttf")),
        (Path(r"C:\Windows\Fonts\NanumGothic.ttf"), Path(r"C:\Windows\Fonts\NanumGothicBold.ttf")),
    ]
    for regular, bold in candidates:
        if regular.exists() and bold.exists():
            pdfmetrics.registerFont(TTFont("ProMomsKR", str(regular)))
            pdfmetrics.registerFont(TTFont("ProMomsKRBold", str(bold)))
            return "ProMomsKR", "ProMomsKRBold"
    return "Helvetica", "Helvetica-Bold"


REGULAR_FONT, BOLD_FONT = register_fonts()


class ReportDocTemplate(BaseDocTemplate):
    def __init__(self, filename: str):
        super().__init__(
            filename,
            pagesize=A4,
            leftMargin=13 * mm,
            rightMargin=13 * mm,
            topMargin=14 * mm,
            bottomMargin=17 * mm,
            title="ProMoms 객관 지표 기간 분석 리포트",
            author="ProMoms",
        )
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="normal")
        self.addPageTemplates(PageTemplate(id="report", frames=[frame], onPage=self.draw_page))

    def draw_page(self, canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(13 * mm, 12 * mm, A4[0] - 13 * mm, 12 * mm)
        canvas.setFont(REGULAR_FONT, 7.2)
        canvas.setFillColor(SOFT)
        canvas.drawString(13 * mm, 7.8 * mm, "ProMoms · 관리사 입력 기록의 객관적 요약 · 의료 판단 아님")
        canvas.drawRightString(A4[0] - 13 * mm, 7.8 * mm, f"LIVE-SAMPLE-20260916 · {doc.page}")
        canvas.restoreState()


def paragraph_styles():
    base = getSampleStyleSheet()
    return {
        "eyebrow": ParagraphStyle(
            "eyebrow",
            parent=base["Normal"],
            fontName=BOLD_FONT,
            fontSize=7.5,
            leading=10,
            textColor=CORAL,
            spaceAfter=2 * mm,
            tracking=1.1,
        ),
        "title": ParagraphStyle(
            "title",
            parent=base["Title"],
            fontName=BOLD_FONT,
            fontSize=22,
            leading=28,
            textColor=GREEN,
            alignment=TA_LEFT,
            spaceAfter=2.5 * mm,
        ),
        "subtitle": ParagraphStyle(
            "subtitle",
            parent=base["Normal"],
            fontName=REGULAR_FONT,
            fontSize=9.2,
            leading=14,
            textColor=SOFT,
        ),
        "section": ParagraphStyle(
            "section",
            parent=base["Heading2"],
            fontName=BOLD_FONT,
            fontSize=13.5,
            leading=18,
            textColor=GREEN,
            spaceBefore=2 * mm,
            spaceAfter=2.5 * mm,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["Normal"],
            fontName=REGULAR_FONT,
            fontSize=8.5,
            leading=13,
            textColor=INK,
        ),
        "small": ParagraphStyle(
            "small",
            parent=base["Normal"],
            fontName=REGULAR_FONT,
            fontSize=7.5,
            leading=11,
            textColor=SOFT,
        ),
        "kpi_label": ParagraphStyle(
            "kpi_label",
            parent=base["Normal"],
            fontName=REGULAR_FONT,
            fontSize=7.2,
            leading=9,
            textColor=SOFT,
        ),
        "kpi_value": ParagraphStyle(
            "kpi_value",
            parent=base["Normal"],
            fontName=BOLD_FONT,
            fontSize=15.5,
            leading=19,
            textColor=GREEN,
        ),
        "table_header": ParagraphStyle(
            "table_header",
            parent=base["Normal"],
            fontName=BOLD_FONT,
            fontSize=6.6,
            leading=8,
            textColor=GREEN,
        ),
        "table": ParagraphStyle(
            "table",
            parent=base["Normal"],
            fontName=REGULAR_FONT,
            fontSize=6.3,
            leading=8,
            textColor=INK,
        ),
    }


STYLES = paragraph_styles()


def p(text: str, style: str = "body") -> Paragraph:
    return Paragraph(text, STYLES[style])


def banner() -> Table:
    content = [
        p("PROMOMS OBJECTIVE CARE REPORT", "eyebrow"),
        p("산후조리 기간 분석 리포트", "title"),
        p("Sarah Kim · Emma Kim · 2026년 9월 10일–9월 16일", "subtitle"),
        p("Report ID LIVE-SAMPLE-20260916 · America/New_York · objective-v1", "small"),
    ]
    table = Table([[content]], colWidths=[180 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), MINT),
                ("BOX", (0, 0), (-1, -1), 0.7, LINE),
                ("LINEBEFORE", (0, 0), (0, 0), 4, GREEN_2),
                ("LEFTPADDING", (0, 0), (-1, -1), 7 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 6 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5 * mm),
            ]
        )
    )
    return table


def kpi_card(label: str, value: str, note: str):
    return [p(label, "kpi_label"), p(value, "kpi_value"), p(note, "small")]


def kpi_grid() -> Table:
    rows = [
        [
            kpi_card("기록 커버리지", "7/7일", "이벤트가 1건 이상인 날짜"),
            kpi_card("구조화 기록", "40건", "선택 배정·기간의 기록"),
            kpi_card("측정 수유량", "1,188 ml", "양 입력 16건 · 미입력 0건"),
        ],
        [
            kpi_card("기록된 수면", "39시간 17분", "8건 합계"),
            kpi_card("체온 표본", "8건", "범위 36.5–36.8℃"),
            kpi_card("체중 표본", "3건", "첫값–마지막값 +0.09kg"),
        ],
    ]
    table = Table(rows, colWidths=[58.7 * mm] * 3, rowHeights=[28 * mm, 28 * mm])
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 4 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 3 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
            ]
        )
    )
    return table


def fact_table() -> Table:
    facts = [
        "선택 기간에 7일, 총 40건의 구조화 기록이 저장되었습니다.",
        "수유 16건 모두 양이 입력되었고, 측정량 합계는 1,188ml입니다.",
        "수면 기록 8건의 합계는 2,357분, 기록 1건당 단순 평균은 294.6분입니다.",
        "체온 측정 8건의 범위는 36.5–36.8℃, 단순 평균은 36.7℃입니다.",
        "체중 첫 기록은 4.15kg, 마지막 기록은 4.24kg이며 단순 차이는 +0.09kg입니다.",
        "기저귀 1건, 목욕 1건, 산모 케어 3건이 입력되었습니다.",
    ]
    rows = [[p(f"<b>{index + 1:02d}</b>", "small"), p(text, "body")] for index, text in enumerate(facts)]
    table = Table(rows, colWidths=[10 * mm, 167 * mm])
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F3F7F4")),
                ("LINEBELOW", (0, 0), (-1, -2), 0.4, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 3 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 2.3 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2.3 * mm),
            ]
        )
    )
    return table


def bar_chart(title: str, values: list[float | None], unit: str, color) -> Drawing:
    width = 252
    height = 138
    drawing = Drawing(width, height)
    drawing.add(String(0, 124, title, fontName=BOLD_FONT, fontSize=9, fillColor=GREEN))
    drawing.add(String(0, 111, f"일별 입력값 · {unit} · 막대 없음은 기록 없음", fontName=REGULAR_FONT, fontSize=5.8, fillColor=SOFT))
    chart_left, chart_bottom, chart_width, chart_height = 27, 24, 218, 76
    finite = [value for value in values if value is not None]
    maximum = max(finite) if finite else 1
    for step in range(3):
        y = chart_bottom + chart_height * step / 2
        drawing.add(Line(chart_left, y, chart_left + chart_width, y, strokeColor=LINE, strokeWidth=0.5))
        label = maximum * step / 2
        drawing.add(String(chart_left - 3, y - 2, f"{label:.0f}", textAnchor="end", fontName=REGULAR_FONT, fontSize=5, fillColor=SOFT))
    labels = ["9/10", "9/11", "9/12", "9/13", "9/14", "9/15", "9/16"]
    slot = chart_width / len(values)
    for index, value in enumerate(values):
        x = chart_left + slot * index + 6
        if value is None:
            drawing.add(Line(x, chart_bottom + 1, x + 15, chart_bottom + 1, strokeColor=SOFT, strokeWidth=0.7, strokeDashArray=[2, 2]))
        else:
            bar_height = max(1.5, value / maximum * chart_height)
            drawing.add(Rect(x, chart_bottom, 15, bar_height, rx=2, ry=2, fillColor=color, strokeColor=None))
        drawing.add(String(x + 7.5, 11, labels[index], textAnchor="middle", fontName=REGULAR_FONT, fontSize=5.4, fillColor=SOFT))
    return drawing


def chart_grid() -> Table:
    charts = [
        bar_chart("일별 측정 수유량", [152, 140, 152, 142, 154, 166, 282], "ml", GREEN_2),
        bar_chart("일별 기록 수면시간", [306, 323, 340, 357, 374, 296, 361], "분", colors.HexColor("#6D9188")),
        bar_chart("일별 평균 체온", [36.7, 36.8, 36.5, 36.6, 36.6, 36.7, 36.8], "℃", CORAL),
        bar_chart("일별 마지막 체중", [None, 4.15, None, None, 4.21, None, 4.24], "kg", colors.HexColor("#9A765D")),
    ]
    table = Table([[charts[0], charts[1]], [charts[2], charts[3]]], colWidths=[89 * mm, 89 * mm], rowHeights=[53 * mm, 53 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 3 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
            ]
        )
    )
    return table


def daily_table() -> Table:
    headers = ["날짜", "수유", "측정량", "기저귀", "수면", "체온 min/avg/max", "최근 체중", "산모 케어"]
    rows = [
        ["9/10", "2건", "152ml", "0건", "306분", "36.7/36.7/36.7", "—", "0건"],
        ["9/11", "2건", "140ml", "0건", "323분", "36.8/36.8/36.8", "4.15kg", "0건"],
        ["9/12", "2건", "152ml", "0건", "340분", "36.5/36.5/36.5", "—", "1건"],
        ["9/13", "2건", "142ml", "0건", "357분", "36.6/36.6/36.6", "—", "0건"],
        ["9/14", "2건", "154ml", "0건", "374분", "36.6/36.6/36.6", "4.21kg", "0건"],
        ["9/15", "2건", "166ml", "0건", "296분", "36.7/36.7/36.7", "—", "0건"],
        ["9/16", "4건", "282ml", "1건", "361분", "36.8/36.8/36.8", "4.24kg", "2건"],
    ]
    data = [[p(value, "table_header") for value in headers]] + [[p(value, "table") for value in row] for row in rows]
    table = Table(data, repeatRows=1, colWidths=[18 * mm, 17 * mm, 20 * mm, 18 * mm, 20 * mm, 39 * mm, 24 * mm, 23 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), MINT),
                ("GRID", (0, 0), (-1, -1), 0.45, LINE),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, CREAM]),
                ("LEFTPADDING", (0, 0), (-1, -1), 1.8 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 1.8 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
            ]
        )
    )
    return table


def hourly_table() -> Table:
    headers = ["날짜", "시간", "기록 유형", "입력값·원문", "입력자"]
    rows = [
        ["9/16", "오전 10:22", "수유", "유축 모유 · 80ml", "Mina Kim"],
        ["9/16", "오전 11:05", "기저귀", "소변 medium · 대변 normal · 색상 yellow", "Mina Kim"],
        ["9/16", "오전 11:20", "수면", "48분", "Mina Kim"],
        ["9/16", "오후 12:30", "산모 케어", "Rest support · 입력 메모 원문", "Mina Kim"],
        ["9/16", "오후 12:40", "수유", "분유 · 70ml", "Mina Kim"],
        ["9/16", "오후 1:10", "수유", "분유 · 55ml", "Mina Kim"],
        ["9/16", "오후 1:15", "체온", "36.8℃", "Mina Kim"],
        ["9/16", "오후 1:35", "산모 케어", "Light stretching · 입력 메모 원문", "Mina Kim"],
        ["9/16", "오후 3:05", "수면", "313분", "Mina Kim"],
        ["9/16", "오후 4:15", "체온", "36.8℃", "Mina Kim"],
        ["9/15", "오전 9:20", "수유", "유축 모유 · 92ml", "Mina Kim"],
        ["9/15", "오후 1:10", "수유", "분유 · 74ml", "Mina Kim"],
        ["9/15", "오후 3:05", "수면", "296분", "Mina Kim"],
        ["9/15", "오후 4:15", "체온", "36.7℃", "Mina Kim"],
    ]
    data = [[p(value, "table_header") for value in headers]] + [[p(value, "table") for value in row] for row in rows]
    table = Table(data, repeatRows=1, colWidths=[22 * mm, 25 * mm, 24 * mm, 78 * mm, 30 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), MINT),
                ("GRID", (0, 0), (-1, -1), 0.45, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, CREAM]),
                ("LEFTPADDING", (0, 0), (-1, -1), 2 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 2 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 2.3 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2.3 * mm),
            ]
        )
    )
    return table


def build_pdf(output_path: Path):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    doc = ReportDocTemplate(str(output_path))
    story = [
        banner(),
        Spacer(1, 4 * mm),
        p("데이터 범위", "section"),
        p("7일 중 기록일 7일 · 구조화 이벤트 40건 · 완료 방문시간 기록 없음", "body"),
        p("기록 없음은 실제 0과 구분합니다. 자유메모는 원문 표에만 표시하고 수치 집계에는 사용하지 않습니다.", "small"),
        Spacer(1, 3 * mm),
        kpi_grid(),
        Spacer(1, 4 * mm),
        p("객관적 자동 요약", "section"),
        fact_table(),
        Spacer(1, 4 * mm),
        p("이 문서는 입력 기록의 집계이며 의료 진단·성장 판정·건강 상태 평가를 제공하지 않습니다.", "small"),
        PageBreak(),
        p("변화 추이", "section"),
        p("선택 기간의 일별 기록값을 그대로 표시합니다. 정상·위험·호전·악화 판정은 하지 않습니다.", "small"),
        Spacer(1, 2 * mm),
        chart_grid(),
        Spacer(1, 5 * mm),
        p("일자별 표", "section"),
        p("단위와 표본 수를 함께 표시하며, 측정값이 없는 항목은 ‘—’로 표시합니다.", "small"),
        Spacer(1, 2 * mm),
        daily_table(),
        PageBreak(),
        p("시간별 상세 기록", "section"),
        p("관리사가 입력한 구조화 값과 자유메모 원문을 시간순으로 표시합니다. 자유문장의 숫자는 자동 집계에 사용하지 않습니다.", "small"),
        Spacer(1, 3 * mm),
        hourly_table(),
        Spacer(1, 6 * mm),
        KeepTogether(
            [
                p("산출 기준", "section"),
                p("• 시간대: America/New_York<br/>• 측정 수유량: amount 숫자가 입력된 기록만 합산<br/>• 기록 없음과 0을 분리<br/>• 체온·체중: 단순 통계만 표시하고 상태 판정 없음<br/>• 자유메모: 원문 표에만 표시하고 수치 추출 없음", "body"),
            ]
        ),
    ]
    doc.build(story)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    build_pdf(args.output)


if __name__ == "__main__":
    main()

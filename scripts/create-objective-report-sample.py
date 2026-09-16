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
            title="ProMoms 산후조리 관리 기록 리포트",
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
        canvas.drawString(13 * mm, 7.8 * mm, "ProMoms · 관리사가 작성한 돌봄 기록 요약 · 의료 판단 아님")
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
        p("PROMOMS CARE RECORD REPORT", "eyebrow"),
        p("산후조리 관리 기록 리포트", "title"),
        p("Sarah Kim · Emma Kim · 2026년 9월 10일~9월 16일", "subtitle"),
        p("리포트 번호 LIVE-SAMPLE-20260916 · 기준 시간 미국 동부시간", "small"),
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
            kpi_card("관리 기간", "7일", "7일 모두 관리 기록 있음"),
            kpi_card("관리사의 기록 횟수", "40회", "선택한 관리 기간 동안 작성"),
            kpi_card("수유량 합계", "1,188 ml", "수유량 입력 16회 · 미입력 0회"),
        ],
        [
            kpi_card("수면 시간 합계", "39시간 17분", "수면 기록 8회 합계"),
            kpi_card("체온 측정", "8회", "최저 36.5℃ · 최고 36.8℃"),
            kpi_card("체중 측정", "3회", "첫 측정 대비 마지막 측정 +0.09kg"),
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
        "7일 동안 관리사가 총 40회 기록했습니다.",
        "수유 16회 모두 수유량이 입력되었으며, 합계는 1,188ml입니다.",
        "수면 기록 8회의 합계는 2,357분이며, 한 번 기록할 때 평균은 294.6분입니다.",
        "체온은 8회 측정했으며, 최저 36.5℃, 최고 36.8℃, 평균 36.7℃입니다.",
        "첫 체중 측정값은 4.15kg, 마지막 측정값은 4.24kg으로 마지막 값이 0.09kg 높습니다.",
        "기저귀 1회, 목욕 1회, 산모 돌봄 3회가 기록되었습니다.",
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
    drawing.add(String(0, 111, f"날짜별 기록 · {unit} · 막대가 없으면 입력된 값이 없음", fontName=REGULAR_FONT, fontSize=5.8, fillColor=SOFT))
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
        bar_chart("날짜별 수유량", [152, 140, 152, 142, 154, 166, 282], "ml", GREEN_2),
        bar_chart("날짜별 수면 시간", [306, 323, 340, 357, 374, 296, 361], "분", colors.HexColor("#6D9188")),
        bar_chart("날짜별 평균 체온", [36.7, 36.8, 36.5, 36.6, 36.6, 36.7, 36.8], "℃", CORAL),
        bar_chart("날짜별 마지막 체중 측정", [None, 4.15, None, None, 4.21, None, 4.24], "kg", colors.HexColor("#9A765D")),
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
    headers = ["날짜", "수유 횟수", "수유량", "기저귀", "수면 시간", "체온 최저/평균/최고", "마지막 체중", "산모 돌봄"]
    rows = [
        ["9/10", "2회", "152ml", "0회", "306분", "36.7/36.7/36.7", "없음", "0회"],
        ["9/11", "2회", "140ml", "0회", "323분", "36.8/36.8/36.8", "4.15kg", "0회"],
        ["9/12", "2회", "152ml", "0회", "340분", "36.5/36.5/36.5", "없음", "1회"],
        ["9/13", "2회", "142ml", "0회", "357분", "36.6/36.6/36.6", "없음", "0회"],
        ["9/14", "2회", "154ml", "0회", "374분", "36.6/36.6/36.6", "4.21kg", "0회"],
        ["9/15", "2회", "166ml", "0회", "296분", "36.7/36.7/36.7", "없음", "0회"],
        ["9/16", "4회", "282ml", "1회", "361분", "36.8/36.8/36.8", "4.24kg", "2회"],
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
    headers = ["날짜", "시간", "돌봄 내용", "기록 내용", "작성자"]
    rows = [
        ["9/16", "오전 10:22", "수유", "유축 모유 · 80ml", "Mina Kim"],
        ["9/16", "오전 11:05", "기저귀", "소변 양 중간 · 대변 상태 보통 · 노란색", "Mina Kim"],
        ["9/16", "오전 11:20", "수면", "48분", "Mina Kim"],
        ["9/16", "오후 12:30", "산모 돌봄", "휴식 도움 · 관리사가 작성한 메모", "Mina Kim"],
        ["9/16", "오후 12:40", "수유", "분유 · 70ml", "Mina Kim"],
        ["9/16", "오후 1:10", "수유", "분유 · 55ml", "Mina Kim"],
        ["9/16", "오후 1:15", "체온", "36.8℃", "Mina Kim"],
        ["9/16", "오후 1:35", "산모 돌봄", "가벼운 스트레칭 · 관리사가 작성한 메모", "Mina Kim"],
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
        p("관리 기간과 기록", "section"),
        p("관리 기간 7일 · 기록이 있는 날 7일 · 관리사 기록 40회 · 방문 완료 시간은 기록되지 않음", "body"),
        p("입력하지 않은 항목은 0으로 보지 않습니다. 직접 작성한 메모는 상세 기록에서만 보여주며, 합계나 평균 계산에는 포함하지 않습니다.", "small"),
        Spacer(1, 3 * mm),
        kpi_grid(),
        Spacer(1, 4 * mm),
        p("관리 기록 한눈에 보기", "section"),
        fact_table(),
        Spacer(1, 4 * mm),
        p("이 문서는 관리사가 입력한 기록을 모아 보여줍니다. 의료 진단이나 성장·건강 상태에 대한 판단을 제공하지 않습니다.", "small"),
        PageBreak(),
        p("날짜별 기록 변화", "section"),
        p("관리 기간에 입력된 값을 날짜별로 보여줍니다. 정상·위험 또는 호전·악화 여부는 판단하지 않습니다.", "small"),
        Spacer(1, 2 * mm),
        chart_grid(),
        Spacer(1, 5 * mm),
        p("날짜별 기록", "section"),
        p("횟수와 단위를 함께 표시하며, 입력된 값이 없는 항목은 ‘없음’으로 표시합니다.", "small"),
        Spacer(1, 2 * mm),
        daily_table(),
        PageBreak(),
        p("시간별 상세 기록", "section"),
        p("관리사가 선택하거나 숫자로 입력한 내용과 직접 작성한 메모를 시간순으로 보여줍니다. 메모에 적힌 숫자는 합계나 평균 계산에 포함하지 않습니다.", "small"),
        Spacer(1, 3 * mm),
        hourly_table(),
        Spacer(1, 6 * mm),
        KeepTogether(
            [
                p("계산 및 표시 방법", "section"),
                p("• 기준 시간: 미국 동부시간<br/>• 수유량 합계: 수유량 숫자가 입력된 기록만 더함<br/>• 입력하지 않음과 0을 다르게 표시<br/>• 체온·체중: 측정한 값의 요약만 보여주며 건강 상태를 판단하지 않음<br/>• 직접 작성한 메모: 상세 기록에만 보여주며 메모 속 숫자는 계산에 포함하지 않음", "body"),
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

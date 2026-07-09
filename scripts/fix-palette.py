from pathlib import Path
import re

files = [
    Path('client/src/index.css'),
    Path('client/src/components/Login.jsx'),
    Path('client/src/components/TeacherDashboard.jsx'),
    Path('client/src/components/StudentQuiz.jsx'),
]

replacements = [
    (re.compile(r'rgba\(99,102,241,'), 'rgba(56,182,255,'),
    (re.compile(r'rgba\(16,185,129,'), 'rgba(34,197,94,'),
    (re.compile(r'rgba\(239,68,68,'), 'rgba(244,63,94,'),
    (re.compile(r"#6EE7B7"), 'var(--success)'),
    (re.compile(r"#FDE68A"), 'var(--warn)'),
    (re.compile(r"#FCA5A5"), 'var(--danger)'),
    (re.compile(r"#10B981"), 'var(--success)'),
    (re.compile(r"#EF4444"), 'var(--danger)'),
    (re.compile(r"#1e1b4b"), 'rgba(7,15,28,0.95)'),
]

js_replacements = [
    (re.compile(r"color:\s*'#10B981'"), "color: 'var(--success)"),
    (re.compile(r"color:\s*'#EF4444'"), "color: 'var(--danger)"),
    (re.compile(r"color:\s*'#6EE7B7'"), "color: 'var(--success)"),
    (re.compile(r"color:\s*'#FDE68A'"), "color: 'var(--warn)"),
    (re.compile(r"color:\s*'#FCA5A5'"), "color: 'var(--danger)"),
]

extra = [
    (
        Path('client/src/components/TeacherDashboard.jsx'),
        re.compile(r"background:\s*'radial-gradient\(ellipse 800px 500px at 60% -120px,rgba\(99,102,241,0\.16\),transparent\),var\(--bg\)'") ,
        "background: 'radial-gradient(ellipse 800px 500px at 60% -120px,rgba(56,182,255,0.16),transparent),var(--bg)'"
    ),
    (
        Path('client/src/components/TeacherDashboard.jsx'),
        re.compile(r"borderColor:activeQuiz\?'rgba\(99,102,241,0\.35\)'") ,
        "borderColor:activeQuiz?'rgba(56,182,255,0.35)'"
    ),
]

for path in files:
    text = path.read_text(encoding='utf-8')
    orig = text
    for pattern, repl in replacements:
        text = pattern.sub(repl, text)
    if path.name in ('Login.jsx', 'TeacherDashboard.jsx', 'StudentQuiz.jsx'):
        for pattern, repl in js_replacements:
            text = pattern.sub(repl, text)
    for p, pattern, repl in extra:
        if path == p:
            text = pattern.sub(repl, text)
    if text != orig:
        path.write_text(text, encoding='utf-8')
        print(f'Updated {path}')

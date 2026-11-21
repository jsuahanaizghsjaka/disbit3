# Builds frontend/terms.html, privacy.html and consent.html from legal/*.md.
# Usage from the repo root:  python legal/build.py   (or: python legal/build.py terms)
# Markup in .md: "# " title, "=" edition line, "## " section, "#id Title" part
# with an anchor, "- " list item, "> " quote, **bold**, [text](url).
import html,os,re,subprocess,sys
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES={'terms':('Пользовательское соглашение','#register'),
       'privacy':('Политика обработки персональных данных','#profile'),
       'consent':('Согласие на обработку персональных данных','#register')}
if len(sys.argv)<5:
  for name in sys.argv[1:] or PAGES:
    title,back=PAGES[name]
    subprocess.run([sys.executable,__file__,os.path.join(ROOT,'legal',name+'.md'),title,
      os.path.join(ROOT,'frontend',name+'.html'),back],check=True)
  sys.exit(0)
src,title,out,back=sys.argv[1:5]
head=open(os.path.join(ROOT,'frontend','terms.html'),encoding='utf-8').read().split('<style>')[0]
head=re.sub(r'<title>.*?</title>',f'<title>{title} — disbit</title>',head)
css="""<style>
    :root {
      color-scheme: dark;
      --bg: #0B1324; --card: #14233B; --line: #2B3C56;
      --text: #F4F7FF; --text-2: #AEBBD1; --primary: #9AB2FF;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; background: var(--bg); color: var(--text);
      font-family: 'Onest', system-ui, sans-serif; line-height: 1.6;
      padding: max(24px, env(safe-area-inset-top)) 20px calc(48px + env(safe-area-inset-bottom));
    }
    .wrap { max-width: 680px; margin: 0 auto; }
    .logo { font-family: 'Unbounded', sans-serif; font-weight: 800; font-size: 22px; letter-spacing: -0.5px; }
    .logo span { color: var(--primary); }
    h1 { font-size: clamp(24px,6vw,32px); line-height: 1.2; margin: 20px 0 12px; overflow-wrap: anywhere; }
    .upd { color: var(--text-2); font-size: 14px; margin: 0 0 28px; }
    h2 { font-size: 17px; font-weight: 800; margin: 28px 0 10px; scroll-margin-top: 16px; }
    h2.part { font-size: 22px; margin-top: 44px; }
    p, li { color: var(--text-2); font-size: 16px; line-height: 24px; }
    ul { padding-left: 20px; margin: 8px 0; }
    li { margin-bottom: 6px; }
    strong { color: var(--text); }
    a { color: var(--primary); overflow-wrap: anywhere; text-underline-offset: 4px; }
    a:focus-visible { outline: 2px solid var(--primary); outline-offset: 4px; border-radius: 4px; }
    blockquote { margin: 12px 0; padding: 12px 16px; border-left: 3px solid var(--primary); background: var(--card); border-radius: 0 12px 12px 0; color: var(--text-2); }
    .back { display: inline-flex; align-items: center; min-height: 44px; margin-block: 16px; font-weight: 700; }
    .docs { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--line); font-size: 14px; }
  </style>
"""
def inline(t):
    t=html.escape(t,quote=False)
    t=re.sub(r'\*\*(.+?)\*\*',r'<strong>\1</strong>',t)
    t=re.sub(r'\[([^\]]+)\]\(([^)]+)\)',r'<a href="\2">\1</a>',t)
    t=re.sub(r'(?<![">])(https://disbit\.ru)',r'<a href="\1">\1</a>',t)
    t=t.replace('disbitx1@gmail.com','<a href="mailto:disbitx1@gmail.com">disbitx1@gmail.com</a>')
    return t
body=[];inlist=False;quote=[]
def flush_quote():
    global quote
    if quote: body.append('<blockquote>'+'<br><br>'.join(quote)+'</blockquote>'); quote=[]
for line in open(src,encoding='utf-8').read().splitlines():
    if not line.strip(): continue
    if line.startswith('> '): quote.append(inline(line[2:])); continue
    flush_quote()
    if line.startswith('- '):
        if not inlist: body.append('<ul>'); inlist=True
        body.append(f'<li>{inline(line[2:])}</li>'); continue
    if inlist: body.append('</ul>'); inlist=False
    if line.startswith('# '): body.append(f'<h1>{inline(line[2:])}</h1>')
    elif line.startswith('='): body.append(f'<p class="upd edition">{inline(line[1:])}</p>')
    elif line.startswith('## '): body.append(f'<h2>{inline(line[3:])}</h2>')
    elif line.startswith('#'): i,t=line[1:].split(' ',1); body.append(f'<h2 class="part" id="{i}">{inline(t)}</h2>')
    else: body.append(f'<p>{inline(line)}</p>')
flush_quote()
if inlist: body.append('</ul>')
docs='<nav class="docs" aria-label="Документы"><a href="terms.html">Пользовательское соглашение</a><a href="terms.html#refunds">Правила возврата</a><a href="privacy.html">Политика обработки данных</a><a href="consent.html">Согласие на обработку данных</a></nav>'
page=head+css+"""</head>
<body>
  <main class="wrap">
    <a class="back" href="index.html"""+back+"""">← В приложение</a>
    <div class="logo">dis<span>bit</span></div>
    """+"\n    ".join(body)+"""
    """+docs+"""
    <a class="back" href="index.html"""+back+"""">← Вернуться в приложение</a>
  </main>
</body>
</html>
"""
open(out,'w',encoding='utf-8',newline='\n').write(page.replace('\n','\r\n')); print('wrote',out,len(page))

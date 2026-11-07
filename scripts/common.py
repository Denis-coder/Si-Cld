import re,datetime,calendar,json,os
KEYS=['name','type','sn','year','range','cls','place','object','dept','inst','interval','date','kind']
RX=re.compile(r'манометр|термометр\s+биметалл|термоманометр',re.I)
def s(v):
    if v is None: return ''
    if isinstance(v,datetime.datetime): return v.strftime('%d.%m.%Y')
    if isinstance(v,float) and v.is_integer(): v=int(v)
    return re.sub(r'\s+',' ',str(v)).strip()
def group(r): return 'm' if re.search(r'термоманометр|манометр',r['name'],re.I) else 't'
def eom(y,m):  # конец месяца m (1-based, может выходить за 12)
    y+= (m-1)//12; m=(m-1)%12+1
    return datetime.date(y,m,calendar.monthrange(y,m)[1])
def kind_of(r):
    k=(r.get('kind') or '').strip().lower()[:1]
    return 'К' if k in ('к','k') else 'П' if k in ('п','p') else ''
_mode=[None]
def load_mode():
    if _mode[0] is None:
        try: _mode[0]=json.load(open('data/config.json',encoding='utf-8')).get('intervalMode','rules')
        except Exception: _mode[0]='rules'
    return _mode[0]
def interval(r,mode=None):
    # mode 'table': межповерочный интервал из столбца таблицы (если пусто — как по правилам)
    # mode 'rules': П (госповерка) — 12 мес. для всех; К (калибровка): манометры и термоманометры 12, термометры 24
    mode=mode or load_mode()
    if mode=='table':
        try:
            t=int(r.get('interval') or 0)
            if t>0: return t
        except ValueError: pass
    if kind_of(r)=='П': return 12
    return 24 if re.search(r'термометр',r.get('name',''),re.I) else 12
def due(r,mode=None):
    raw=re.sub(r'[\\\s]','',r.get('date') or '')
    if not raw: return None
    iv=interval(r,mode)
    m=re.match(r'^([1-4])[кk](\d{2})$',raw,re.I)
    if m: return eom(2000+int(m[2]),int(m[1])*3+iv)
    m=re.match(r'^(\d{2})ДЯУ$',raw,re.I)
    if m: return datetime.date(2000+int(m[1])+iv//12,12,31)
    m=re.match(r'^(\d{1,2})\.(\d{1,2})\.(\d{4})$',raw)
    if m:
        y,mo=int(m[3]),int(m[2])+iv; y+=(mo-1)//12; mo=(mo-1)%12+1
        return datetime.date(y,mo,min(int(m[1]),calendar.monthrange(y,mo)[1]))
    m=re.match(r'^(\d{1,2})\.(\d{4})$',raw)
    if m: return eom(int(m[2]),int(m[1])+iv)
    return None
def status(r,today=None,mode=None):
    d=due(r,mode); today=today or datetime.date.today()
    if not d: return ''
    days=(d-today).days
    return 'red' if days<0 else 'yel' if days<=92 else 'grn'

import json,os
def load_db():
    idx=json.load(open('data/index.json',encoding='utf-8'))['sheets']
    return {m['name']:json.load(open('data/s/'+m['file'],encoding='utf-8'))['rows'] for m in idx}
RKEYS=['name','type','sn','year','range','cls','thread','interval','date','orient']   # листы «Резерв»
def load_index(): return {m['name']:m for m in json.load(open('data/index.json',encoding='utf-8'))['sheets']}
def save_db(sheets,meta=None):
    meta=meta or {}; os.makedirs('data/s',exist_ok=True); idx=[]
    for i,(n,rows) in enumerate(sheets.items()):
        idx.append({'name':n,'file':f'{i}.json',**meta.get(n,{})})
        json.dump({'rows':rows},open(f'data/s/{i}.json','w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
    json.dump({'sheets':idx},open('data/index.json','w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))

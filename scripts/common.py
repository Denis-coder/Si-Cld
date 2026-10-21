import re,datetime,calendar
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
def due(r):
    raw=re.sub(r'[\\\s]','',r.get('date') or '')
    if not raw: return None
    try: iv=int(r.get('interval') or 0)
    except ValueError: iv=0
    if iv<=0: iv=12 if group(r)=='m' else 24
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
def status(r,today=None):
    d=due(r); today=today or datetime.date.today()
    if not d: return ''
    days=(d-today).days
    return 'red' if days<0 else 'yel' if days<=92 else 'grn'

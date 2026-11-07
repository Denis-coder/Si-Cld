# Создаёт данные из source/original.xlsx.  python scripts/seed.py            — с нуля (ПЕРЕЗАПИСЫВАЕТ все данные)
#                                           python scripts/seed.py --add-missing — только добавить листы, которых ещё нет (правки не трогает)
import openpyxl,json,sys,os
sys.path.insert(0,os.path.dirname(__file__)); from common import *
wb=openpyxl.load_workbook('source/original.xlsx'); new={}; meta={}; i=0; z=0
for ws in wb:
    res=ws.title.startswith('Резерв')
    if res: ok=s(ws['H1'].value)=='Тип резьбы' and s(ws['B1'].value)=='Наименование'; ks=RKEYS
    else: ok=s(ws['H1'].value)=='Место установки СИ' and s(ws['B1'].value)=='Наименование'; ks=KEYS
    if not ok: continue
    rows=[]; other=0
    for n,r in enumerate(ws.iter_rows(min_row=2,values_only=True),start=2):
        if r[1] and not RX.search(str(r[1])): other+=1
        if not r[1] or not RX.search(str(r[1])): continue
        d={k:s(r[j+1]) for j,k in enumerate(ks)}
        if res: z+=1; d['id']='z%d'%z
        else: i+=1; d['id']='r%d'%i
        d['x']=n; rows.append(d)
    if rows: new[ws.title]=rows; meta[ws.title]={'keys':ks,'reserve':res,'other':other}
if '--add-missing' in sys.argv and os.path.exists('data/index.json'):
    idx=json.load(open('data/index.json',encoding='utf-8'))['sheets']; have={m['name'] for m in idx}; added=0
    for n,rows in new.items():
        if n in have: continue
        f=f'{len(idx)}.json'; idx.append({'name':n,'file':f,**meta[n]}); added+=len(rows)
        json.dump({'rows':rows},open('data/s/'+f,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
    for m in idx:   # у уже существующих листов проставляем описание полей, если его не было
        if m['name'] in meta: m.setdefault('keys',meta[m['name']]['keys']); m.setdefault('reserve',meta[m['name']]['reserve']); m.setdefault('other',meta[m['name']]['other'])
    json.dump({'sheets':idx},open('data/index.json','w',encoding='utf-8'),ensure_ascii=False,separators=(',',':')); print('добавлено строк:',added)
else:
    save_db(new,meta); print(sum(map(len,new.values())),'СИ,',len(new),'листов')

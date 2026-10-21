# Ежедневная рассылка push: просрочено / скоро истекает
import json,os,sys
sys.path.insert(0,os.path.dirname(__file__)); from common import *
from pywebpush import webpush,WebPushException
rows=[r for v in json.load(open('data/db.json',encoding='utf-8'))['sheets'].values() for r in v]
red=sum(status(r)=='red' for r in rows); yel=sum(status(r)=='yel' for r in rows)
subs=json.load(open('data/subs.json')); keep=[]
if red+yel:
    msg=json.dumps({'title':'Учёт СИ','body':f'Просрочено: {red}. Скоро истекает (<3 мес.): {yel}.'})
    for sub in subs.get('subs',[]):
        try: webpush({k:sub[k] for k in('endpoint','keys')},msg,vapid_private_key=os.environ['VAPID_PRIVATE'],vapid_claims={'sub':'mailto:admin@example.com'}); keep.append(sub)
        except WebPushException as e:
            if e.response is None or e.response.status_code not in(404,410): keep.append(sub)
            print('push error',e)
    subs['subs']=keep; json.dump(subs,open('data/subs.json','w'))
print('red',red,'yel',yel)

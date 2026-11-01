# Одноразовый перенос старого формата (data/db.json, data/history.json) в новый (data/s/*.json, data/history/ГГГГ-ММ.json)
import json,os,sys,collections
sys.path.insert(0,os.path.dirname(__file__)); from common import *
if not os.path.exists('data/db.json'): print('db.json нет — переносить нечего'); sys.exit()
save_db(json.load(open('data/db.json',encoding='utf-8'))['sheets'])
if os.path.exists('data/history.json'):
    os.makedirs('data/history',exist_ok=True); by=collections.defaultdict(list)
    for h in json.load(open('data/history.json',encoding='utf-8')): by[h['t'][:7]].append(h)
    for k,v in by.items(): json.dump(v,open(f'data/history/{k}.json','w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
    os.remove('data/history.json')
if os.path.exists('data/users.json'):   # публичные зашифрованные токены больше не храним
    u=json.load(open('data/users.json',encoding='utf-8'))
    for x in u['users']: x.pop('tok',None)
    json.dump(u,open('data/users.json','w',encoding='utf-8'),ensure_ascii=False)
os.remove('data/db.json'); print('готово')

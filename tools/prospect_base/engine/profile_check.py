"""Garante que um perfil está completo e SEM pendências antes de rodar (nada de deduzir)."""
REQUIRED = ['NAME','REF_YEAR','VETTED_STAGE','load','PLACEHOLDER','NAME_CITIES','NAME_DESC_RE','MANUAL_NAMES','BRANDS',
 'CITYLIST','COMPOSITE','regiao','DEFAULT_UF','UF_BY_CITY','MAIN_DDDS','NOMERGE','EXCL_WA','FLAGS_BY_KEY','FILL_PEOPLE',
 'extra_clean','source_fields','TEXT_FIELDS_FULL','TEXT_FIELDS_NARROW','FLAGS','DIMS','RULES','BANDS','INCOMPLETE_BAND',
 'PRIORITY_ORDER','motivo','HAND','make_hook','COLUMNS','LAST_COLUMN','OUTPUT_LABELS','OUTPUT_NAME','DICTIONARY']
def check(P):
    miss = [k for k in REQUIRED if not hasattr(P, k)]
    if miss:
        raise SystemExit('Perfil incompleto, faltam: ' + ', '.join(miss))
    todo = [k for k in REQUIRED if isinstance(getattr(P, k), str) and getattr(P, k).startswith('TODO')]
    if todo:
        raise SystemExit('Itens ainda marcados TODO (alinhar com o usuário antes): ' + ', '.join(todo))
    if P.COLUMNS[-1] != P.LAST_COLUMN:
        raise SystemExit('A coluna de gancho deve ser a última de COLUMNS')

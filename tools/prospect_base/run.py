"""Uso:  python run.py <perfil> <arquivo_entrada.xlsx> <pasta_saida>
Ex.:    python run.py _modelo LISTA.xlsx ./saida"""
import sys, importlib, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine import pipeline, profile_check
perfil, src, out = sys.argv[1:4]
P = importlib.import_module(f'profiles.{perfil}')
profile_check.check(P)
res = pipeline.run(P, src, out)
B = res['base']
print(f"Entrada: {res['n_input_rows']} linhas -> {len(B)} registros únicos | arquivo: {res['path']}.xlsx/.csv")
print('Etapa:', B['Etapa'].value_counts().to_dict()); print('Prioridade:', B['Prioridade'].value_counts().to_dict())
print('ERROS DE VALIDAÇÃO:', res['errors'] or 'nenhum'); print('Nomes repetidos (conferir se são mesmo escritórios distintos):', res['duplicate_names'] or 'nenhum')

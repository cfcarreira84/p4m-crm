#!/usr/bin/env python3
"""Testes do enriquecimento por regras e do mapeamento flexível da carga (sem rede e sem banco).

    python tools/testar_carga.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import carga_base as cb  # noqa: E402

CONTRATO_TESTE_MODELOS = {
    **cb.CONTRATO_ATIVO,
    "hookValidation": {
        **cb.CONTRATO_ATIVO.get("hookValidation", {}),
        "requireTwoParagraphs": True,
    },
    "enrichment": {
        "siteUrl": "https://exemplo.com.br",
        "models": {
            "mod_a": ["Linha Residencial Pro", "linha-residencial-pro"],
            "mod_b": ["Linha Compacta", "linha-compacta"],
            "mod_c": ["Linha Corporativa", "linha-corporativa"],
            "mod_d": ["Linha Lazer", "linha-lazer"],
        },
        "signals": {
            "lazer": r"lazer|gourmet|recrea[cç][aã]o|pet\s*place",
            "compacto": r"apartament\w*|\bstudios?\b|compactos?",
            "comercial": r"comerciai?s?|corporativ\w*|restaurantes?",
            "residencial": r"residen[cç]\w*|\bcasas?\b|condom[ií]ni\w*",
            "obra": r"gerenciamento de obra|executa\w*|construtora|incorpora\w*",
        },
        "questions": {
            "lazer": "se os projetos em andamento têm área de lazer equipada",
            "obra": "o cronograma da obra para alinhar a janela de compras",
            "compacto": "se há unidades compactas em especificação",
            "comercial": "qual é a demanda para os projetos comerciais",
        },
        "modelRules": [
            {"any": ["lazer"], "add": ["mod_d", "mod_a"]},
            {"any": ["compacto"], "add": ["mod_b"]},
            {"any": ["comercial"], "add": ["mod_c"]},
            {"any": ["residencial"], "onlyIfEmpty": True, "add": ["mod_a"]},
        ],
    },
}


def linha(**kw):
    base = {
        "Nome": "Empresa Teste",
        "Prioridade": "Alta",
        "Pontuação": "80",
        "Motivo da prioridade": "",
        "Etapa": "Qualificado",
        "Região comercial": "Metropolitana",
        "Cidade": "Campinas",
        "UF": "SP",
        "Tipo": "Construtora",
        "Endereço": "Rua A, 100",
        "CEP": "13000-000",
        "WhatsApp (confirmado)": "",
        "WhatsApp (E.164)": "",
        "Celular (provável WhatsApp)": "",
        "Celular (E.164)": "",
        "Telefone fixo": "",
        "Telefone fixo (E.164)": "",
        "Outros telefones": "",
        "E-mail novos projetos": "",
        "E-mail parcerias / fornecedores": "",
        "Site": "",
        "Instagram": "",
        "Responsáveis": "",
        "Perfil dos projetos": "",
        "Obras de referência": "",
        "Argumento prioritário": "",
        "Gancho de abordagem": "",
        "Mini bio": "Bio institucional.",
        "Insights": "",
        "Motivo da qualificação": "",
        "Observação de dados": "",
        "Gancho": "Ana, pesquisei e encontrei a Empresa Teste - e o que me chamou atenção foram os condomínios residenciais.\n\nSomos fabricantes e atendemos direto de fábrica. Posso te enviar o catálogo?",
    }
    base.update(kw)
    return base


ok = 0


def t(nome, fn):
    global ok
    fn()
    ok += 1
    print("  ok", nome)


def sem_dados():
    c = cb.enriquecer(linha(), CONTRATO_TESTE_MODELOS)
    assert c["solucao_recomendada"] == "Sem dados suficientes para elaborar proposta." and not c["modelos"], c


def lazer_sugere_modelos():
    c = cb.enriquecer(linha(**{"Perfil dos projetos": "Condomínios de alto padrão com área de lazer completa"}), CONTRATO_TESTE_MODELOS)
    assert c["modelos"][:2] == ["Linha Lazer", "Linha Residencial Pro"], c
    assert "https://exemplo.com.br/linha-lazer/" in c["solucao_recomendada"], c
    assert "área de lazer" in c["gargalo_critico"], c


def compacto_sugere_modelo():
    c = cb.enriquecer(linha(**{"Perfil dos projetos": "Reformas de apartamentos compactos"}), CONTRATO_TESTE_MODELOS)
    assert "Linha Compacta" in c["modelos"], c


def comercial_sugere_modelo():
    c = cb.enriquecer(linha(**{"Perfil dos projetos": "Projetos comerciais e corporativos"}), CONTRATO_TESTE_MODELOS)
    assert "Linha Corporativa" in c["modelos"], c


def so_argumento():
    c = cb.enriquecer(linha(**{"Argumento prioritário": "Atendimento direto de fábrica", "Perfil dos projetos": "Projetos gerais"}), CONTRATO_TESTE_MODELOS)
    assert not c["modelos"] and "Atendimento direto de fábrica" in c["solucao_recomendada"], c


def limite_de_tres():
    c = cb.enriquecer(
        linha(**{"Perfil dos projetos": "Casas com lazer, apartamentos compactos e projetos comerciais"}),
        CONTRATO_TESTE_MODELOS,
    )
    assert len(c["modelos"]) == 3, c


def nao_inventa_alem_da_pesquisa():
    c = cb.enriquecer(linha(**{"Perfil dos projetos": "Projeto e reforma"}), CONTRATO_TESTE_MODELOS)
    assert not c["modelos"], c


def perfil_regras():
    assert cb.perfil("Interiores") == "B2B_Secundario"
    assert cb.perfil("Construtora residencial") == "B2B_Principal"


def mapeamento_e_dados_segmento():
    r = linha(**{
        "WhatsApp E.164": "+5519981337909",
        "E-mails": "contato@empresa.com.br, compras@empresa.com.br",
        "Empreendimentos (previsão de lançamento/entrega)": "Residencial Sol ; Residencial Lua",
        "Lote": "P01-campinas",
    })
    lead = cb.mapear(r, "teste_lote")
    assert lead["whatsapp_disparo"] == "5519981337909" and lead["whatsapp_confirmado"] is True
    assert lead["email_contato"] == "contato@empresa.com.br"
    assert lead["email_parcerias"] == "compras@empresa.com.br"
    assert lead["dados_segmento"]["empreendimentos"] == "Residencial Sol ; Residencial Lua"
    assert lead["dados_segmento"]["lote"] == "P01-campinas"
    assert lead["pre_analise_scout"]["analise_complementar"]["metodo"] == "regras_base"
    assert lead["status_kanban"] == "aguardando_contato" and lead["prioridade_carga"] == "alta"


def sem_canal_vai_para_observacao():
    lead = cb.mapear(linha(), "teste")
    assert lead["whatsapp_disparo"] is None and "Sem nenhum canal de contato" in (lead["observacao_dados"] or "")


def erros_de(contrato=None, **kw):
    erros, avisos = [], []
    cb.validar_linha(linha(**kw), 2, erros, avisos, contrato or CONTRATO_TESTE_MODELOS)
    return " | ".join(str(e) for e in erros)


def gancho_humano_passa():
    assert not erros_de(), erros_de()


def gancho_robotizado_e_bloqueado():
    assert "posicionamento" in erros_de(**{"Gancho": "Ana, pesquisei e encontrei a empresa X: obras de alto padrão.\n\nSomos fabricantes."})
    assert "posicionamento" in erros_de(**{"Gancho": "Pesquisei e encontrei a empresa X e, pelo que vi, atua com casas.\n\nSomos fabricantes."})


def gancho_em_bloco_unico_configuravel():
    # Quando requireTwoParagraphs=True bloqueia; quando False (padrão do starter) permite com aviso
    assert "bloco só" in erros_de(CONTRATO_TESTE_MODELOS, **{"Gancho": "Olá! Pesquisei e encontrei a Empresa X. Posso enviar o catálogo?"})
    assert not erros_de(cb.CONTRATO_ATIVO, **{"Gancho": "Olá! Pesquisei e encontrei a Empresa X. Posso enviar o catálogo?"})


def gancho_com_colchetes_e_bloqueado():
    assert "colchetes" in erros_de(**{"Gancho": "Ana, pesquisei e encontrei [X].\n\nSomos fabricantes."})


def perfil_forcado():
    cb.PERFIL_FORCADO = "B2B_Parceiros"
    try:
        assert cb.perfil("Construtora") == "B2B_Parceiros"
    finally:
        cb.PERFIL_FORCADO = None
    assert "B2B_Parceiros" in cb.perfis_validos()


for nome, fn in [
    ("sem pesquisa, sem proposta", sem_dados),
    ("lazer sugere modelos configurados", lazer_sugere_modelos),
    ("compacto sugere modelo compacto", compacto_sugere_modelo),
    ("comercial sugere modelo corporativo", comercial_sugere_modelo),
    ("só argumento não inventa modelo", so_argumento),
    ("no máximo 3 modelos", limite_de_tres),
    ("não infere além do que está escrito", nao_inventa_alem_da_pesquisa),
    ("perfil por regras de contrato", perfil_regras),
    ("mapeamento flexível + dados_segmento + múltiplos e-mails", mapeamento_e_dados_segmento),
    ("lead sem canal é marcado", sem_canal_vai_para_observacao),
    ("gancho humano passa", gancho_humano_passa),
    ("gancho robotizado é bloqueado", gancho_robotizado_e_bloqueado),
    ("gancho em bloco único respeita requireTwoParagraphs", gancho_em_bloco_unico_configuravel),
    ("gancho com colchetes é bloqueado", gancho_com_colchetes_e_bloqueado),
    ("--perfil força a categoria da carga", perfil_forcado),
]:
    t(nome, fn)
print(f"\n{ok} verificações ok")

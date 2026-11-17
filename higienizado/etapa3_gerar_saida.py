#!/usr/bin/env python3
"""Etapa 3: Gera ganchos em 2 parágrafos, pontua e exporta Excel + CSV validados para o SDR-COCKPIT."""

import csv
import json
import re
from pathlib import Path
import openpyxl
from openpyxl.styles import Font, PatternFill

BASE_DIR = Path(r"D:\OneDrive\Documentos\202609_Projetos\P4M")
OUT_DIR = BASE_DIR / "higienizado"

EMPRESAS_IN = OUT_DIR / "intermediario_empresas.json"
CACHE_IN = OUT_DIR / "enriquecimento_cache.json"
NETWORK_IN = OUT_DIR / "intermediario_network.json"

CSV_OUT = OUT_DIR / "P4M_base_higienizada.csv"
XLSX_OUT = OUT_DIR / "P4M_base_higienizada.xlsx"
CONC_OUT = OUT_DIR / "concorrentes_removidos.csv"
AMOSTRA_OUT = OUT_DIR / "amostra_ganchos.md"

FIELDNAMES = [
    "Nome",
    "Tipo",
    "Perfil da conta",
    "Vertical / Segmento",
    "Prioridade",
    "Pontuação",
    "Motivo da prioridade",
    "Etapa",
    "Cidade",
    "UF",
    "WhatsApp (E.164)",
    "Telefone fixo (E.164)",
    "Outros telefones",
    "E-mail",
    "Site",
    "Responsável",
    "Cargo do responsável",
    "LinkedIn",
    "Qtd contatos",
    "Outros contatos da empresa",
    "Domínio",
    "Origem bruta",
    "Mini bio",
    "Insights",
    "Argumento prioritário",
    "Observação de dados",
    "Gancho",
]


def first_name(full_name: str) -> str:
    if not full_name:
        return ""
    parts = full_name.strip().split()
    if not parts:
        return ""
    fn = parts[0].strip(",.;:")
    if len(fn) < 2 or fn.lower() in {"equipe", "contato", "sem", "admin", "comercial"}:
        return ""
    return fn.title() if fn.isupper() else fn


GENERIC_TITLE_RE = re.compile(
    r"(hospedagem|dom[ií]nio|under development|em constru[çc][aã]o|manuten[çc][aã]o|sistema cont[aá]bil|"
    r"ag[eê]ncia de marketing e publicidade|consultoria digital|p[aá]gina inicial|site oficial|index of|"
    r"apache|nginx|cpanel|plesk|word\s?press|wix|godaddy|locaweb|hostgator|registro\.br|redirecting)",
    re.I,
)


def sanitize_company_name(nome_mercado: str, empresa_bruta: str, dom: str) -> str:
    if nome_mercado:
        nome_mercado = re.split(r":\s+", nome_mercado)[0].strip()
    if nome_mercado and not GENERIC_TITLE_RE.search(nome_mercado) and 2 <= len(nome_mercado) <= 45:
        return nome_mercado
    if empresa_bruta and not GENERIC_TITLE_RE.search(empresa_bruta):
        return empresa_bruta.title() if (empresa_bruta.isupper() and len(empresa_bruta) > 5) else empresa_bruta
    base = dom.split(".")[0].replace("-", " ").replace("_", " ").strip()
    return base.upper() if len(base) <= 4 else base.title()


def clean_bracket_and_robot(text: str) -> str:
    text = text.replace("[", "(").replace("]", ")")
    # Preservar exatamente \n\n entre parágrafos!
    paras = [re.sub(r"\s+", " ", p).strip() for p in text.split("\n\n") if p.strip()]
    return "\n\n".join(paras)


def build_hook(perfil: str, nome_contato: str, nome_empresa: str, vertical: str, cidade: str, uf: str) -> str:
    fn = first_name(nome_contato)
    saudacao = f"Fala, {fn}! Tudo bem?" if (fn and perfil in ("Agencia", "Network")) else (f"Olá, {fn}! Tudo bem?" if fn else "Olá! Tudo bem?")
    loc_txt = f" em {cidade}/{uf}" if (cidade and uf) else (f" em {cidade}" if cidade else "")
    v_low = (vertical or "").lower()
    if not v_low or "b2b-b2c" in v_low or "empresa /" in v_low:
        vert_pme = "seu segmento"
    else:
        vert_pme = v_low

    if perfil == "Agencia":
        p1 = (
            f"{saudacao} Pesquisei agências de comunicação e marketing e cheguei até a {nome_empresa}{loc_txt}. "
            f"Sabemos o quanto cronogramas apertados de campanha exigem entregas de alto impacto sem inflar a operação interna."
        )
        p2 = (
            "Na Per4media (P4m) atuamos como braço terceiro para agências, entregando Rich Media interativo em 72h (20 sensores mobile), "
            "Mídia Programática em grandes portais e LPs a custo operacional zero para enriquecer as marcas atendidas sem comprometer budget. "
            "Topa um papo rápido de 10 minutos?"
        )
    elif perfil == "Grande_Marca":
        p1 = (
            f"{saudacao} Pesquisei marcas de destaque em {vert_pme} e cheguei até a {nome_empresa}{loc_txt}, "
            f"onde eficiência de mídia e atenção qualificada fazem diferença direta no resultado."
        )
        p2 = (
            "Aqui na Per4media (P4m) levamos marcas para os 71% do tempo conectado fora das redes sociais — Display, Native, Vídeo e Rich Media interativo "
            "em portais como Estadão, Valor, Forbes e UOL, com operação diária transparente. Podemos trocar uma ideia rápida de 10 minutos esta semana?"
        )
    elif perfil == "Network":
        emp_txt = f" ({nome_empresa})" if (nome_empresa and nome_empresa != nome_contato) else ""
        p1 = (
            f"{saudacao} Estou organizando nossa rede de contatos estratégicos ligados a marketing, mídia e negócios{emp_txt} "
            f"para trocar experiências e avaliar parcerias."
        )
        p2 = (
            "Aqui na Per4media (P4m) atuamos com Mídia Programática em grandes portais, Rich Media interativo em 72h e automação comercial com IA no WhatsApp. "
            "Faz sentido trocarmos uma ideia rápida de 10 minutos para ver possíveis sinergias?"
        )
    else:  # PME_Direta
        p1 = (
            f"{saudacao} Pesquisei empresas de {vert_pme} e encontrei a {nome_empresa}{loc_txt}. "
            f"Hoje, depender só do leilão saturado das redes sociais encarece o clique e deixa oportunidades escaparem."
        )
        p2 = (
            "Na Per4media (P4m) colocamos PMEs nos 71% do tempo que o cliente passa fora das redes (portais como UOL, G1, Forbes e Estadão), "
            "com Landing Page e a P4m Flow IA atendendo no WhatsApp em 5 segundos. Topa trocar uma ideia rápida de 10 minutos sem compromisso?"
        )

    return clean_bracket_and_robot(f"{p1}\n\n{p2}")


def calc_priority_corp(emp: dict, enr: dict) -> tuple[int, str, str, str]:
    score = 20
    motivos = []
    if emp["whatsapp_e164"]:
        score += 25
        motivos.append("WhatsApp confirmado")
    if emp["email_principal"]:
        score += 15
        motivos.append("E-mail corporativo")
    if re.search(r"\b(ceo|founder|fundador|s[óo]cio|diretor|director|head|gerente|manager|presidente)\b", emp["cargo_principal"], re.I):
        score += 10
        motivos.append(f"Decisor ({emp['cargo_principal'][:35]})")
    if emp["qtd_contatos"] >= 2:
        score += 10
        motivos.append(f"{emp['qtd_contatos']} contatos mapeados")
    if enr.get("site_status") == 200:
        score += 10
        motivos.append("Site ativo verificado")
    if emp["prio_bruta"].lower() == "alta":
        score += 10
        motivos.append("Prioridade original Alta")

    score = min(100, score)
    if score >= 60:
        prio = "Alta"
    elif score >= 46:
        prio = "Média-alta"
    elif score >= 30:
        prio = "Média"
    else:
        prio = "Baixa"

    etapa = "Qualificado" if (emp["whatsapp_e164"] or enr.get("site_status") == 200) else "A revisar"
    return score, prio, etapa, "; ".join(motivos) or "E-mail corporativo"


def main():
    empresas = json.loads(EMPRESAS_IN.read_text(encoding="utf-8"))
    cache = json.loads(CACHE_IN.read_text(encoding="utf-8"))
    network_list = json.loads(NETWORK_IN.read_text(encoding="utf-8"))

    rows_out = []
    concorrentes = []

    # 1. Processar Empresas Corporativas
    for emp in empresas:
        dom = emp["dominio"]
        enr = cache.get(dom, {})
        if enr.get("is_concorrente"):
            concorrentes.append({
                "Domínio": dom,
                "Empresa Bruta": emp["empresa_bruta"],
                "Motivo Concorrente": enr.get("motivo_concorrente", "Mídia Programática / AdTech"),
                "Qtd Contatos": emp["qtd_contatos"],
            })
            continue

        perfil = enr.get("perfil") or "PME_Direta"
        nome_mercado = sanitize_company_name(enr.get("nome_mercado", ""), emp["empresa_bruta"], dom)
        vertical = enr.get("vertical") or ("Agência de Comunicação" if perfil == "Agencia" else "Serviços B2B/B2C")
        cidade = enr.get("cidade") or emp["cidade_ddd"] or "Brasil"
        uf = enr.get("uf") or emp["uf_ddd"] or ""
        score, prio, etapa, motivo_prio = calc_priority_corp(emp, enr)

        arg_prio = (
            "Terceirização de Rich Media (72h, 20 sensores), Programática em portais e LPs sem onerar operação local"
            if perfil == "Agencia"
            else "Presença nos 71% fora das redes sociais (portais) + LP + P4m Flow IA 24/7 no WhatsApp em 5s"
        )
        obs = []
        if not emp["whatsapp_e164"]:
            obs.append("Sem WhatsApp na base: abordar por e-mail corporativo")
        if cidade == "Brasil":
            obs.append("Cidade não confirmada na base")

        gancho = build_hook(perfil, emp["contato_principal"], nome_mercado, vertical, "" if cidade == "Brasil" else cidade, uf)

        rows_out.append({
            "Nome": nome_mercado,
            "Tipo": perfil,
            "Perfil da conta": perfil,
            "Vertical / Segmento": vertical,
            "Prioridade": prio,
            "Pontuação": str(score),
            "Motivo da prioridade": motivo_prio,
            "Etapa": etapa,
            "Cidade": cidade,
            "UF": uf,
            "WhatsApp (E.164)": emp["whatsapp_e164"],
            "Telefone fixo (E.164)": emp["fixo_e164"],
            "Outros telefones": emp["outros_telefones"],
            "E-mail": emp["email_principal"],
            "Site": emp["site"],
            "Responsável": emp["contato_principal"],
            "Cargo do responsável": emp["cargo_principal"],
            "LinkedIn": emp["linkedin_principal"],
            "Qtd contatos": str(emp["qtd_contatos"]),
            "Outros contatos da empresa": emp["outros_contatos"],
            "Domínio": dom,
            "Origem bruta": emp["origem_bruta"],
            "Mini bio": enr.get("mini_bio", ""),
            "Insights": enr.get("insights", ""),
            "Argumento prioritário": arg_prio,
            "Observação de dados": " | ".join(obs),
            "Gancho": gancho,
        })

    # 2. Processar Network (e-mails pessoais — mantidos com prioridade menor para avaliação humana)
    for c in network_list:
        wa_e164 = c["phone_e164"] if c["phone_type"] == "whatsapp" else ""
        fixo_e164 = c["phone_e164"] if c["phone_type"] == "fixo" else ""
        outros_tel = c["raw_phone"] if c["phone_type"] == "outro" else ""
        nome_card = c["empresa_bruta"] or c["nome"] or c["email"].split("@")[0]

        score = 10
        motivos = ["E-mail pessoal (Network)"]
        if wa_e164:
            score += 12
            motivos.append("WhatsApp confirmado")
        if c["empresa_bruta"]:
            score += 6
            motivos.append("Empresa informada")
        prio = "Baixa" if (wa_e164 or c["empresa_bruta"]) else "A qualificar"
        etapa = "A revisar" if (wa_e164 or c["empresa_bruta"]) else "Dados incompletos"

        obs = ["Lead Network (e-mail pessoal): avaliar individualmente parceria ou descarte"]
        if c["phone_obs"]:
            obs.append(c["phone_obs"])

        gancho = build_hook("Network", c["nome"], nome_card, "marketing e negócios", "", "")

        rows_out.append({
            "Nome": nome_card,
            "Tipo": "Network",
            "Perfil da conta": "Network",
            "Vertical / Segmento": "Network / Contato Individual",
            "Prioridade": prio,
            "Pontuação": str(score),
            "Motivo da prioridade": "; ".join(motivos),
            "Etapa": etapa,
            "Cidade": "Brasil",
            "UF": "",
            "WhatsApp (E.164)": wa_e164,
            "Telefone fixo (E.164)": fixo_e164,
            "Outros telefones": outros_tel,
            "E-mail": c["email"],
            "Site": "",
            "Responsável": c["nome"] or nome_card,
            "Cargo do responsável": c["cargo"],
            "LinkedIn": c["linkedin_url"],
            "Qtd contatos": "1",
            "Outros contatos da empresa": "",
            "Domínio": c["email"].split("@")[-1] if "@" in c["email"] else "",
            "Origem bruta": c["origem"],
            "Mini bio": "",
            "Insights": "Contato individual (e-mail pessoal): avaliar sinergia de network/parceria ou descarte.",
            "Argumento prioritário": "Parceria / Network P4m (Mídia Programática, Rich Media 72h e P4m Flow IA)",
            "Observação de dados": " | ".join(obs),
            "Gancho": gancho,
        })

    # Ordenar por Pontuação decrescente
    rows_out.sort(key=lambda r: int(r["Pontuação"]), reverse=True)

    # 3. Exportar CSV principal
    with open(CSV_OUT, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES)
        w.writeheader()
        w.writerows(rows_out)

    # 4. Exportar Concorrentes Removidos
    with open(CONC_OUT, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["Domínio", "Empresa Bruta", "Motivo Concorrente", "Qtd Contatos"])
        w.writeheader()
        w.writerows(concorrentes)

    # 5. Exportar XLSX com múltiplas abas para Revisão Humana
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Base Única"
    ws.append(FIELDNAMES)
    header_fill = PatternFill("solid", fgColor="1E293B")
    header_font = Font(bold=True, color="FFFFFF")
    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = header_font
    for r in rows_out:
        ws.append([r[k] for k in FIELDNAMES])
    ws.freeze_panes = "A2"

    ws_conc = wb.create_sheet("Concorrentes Removidos")
    ws_conc.append(["Domínio", "Empresa Bruta", "Motivo Concorrente", "Qtd Contatos"])
    for cell in ws_conc[1]:
        cell.fill = header_fill
        cell.font = header_font
    for c in concorrentes:
        ws_conc.append([c["Domínio"], c["Empresa Bruta"], c["Motivo Concorrente"], c["Qtd Contatos"]])

    wb.save(XLSX_OUT)

    # 6. Gerar amostra de 8 ganchos para validação
    sample_lines = ["# Amostra de Ganchos Gerados (8 Exemplos)\n"]
    for prof in ("PME_Direta", "Agencia", "Grande_Marca", "Network"):
        ex = [r for r in rows_out if r["Perfil da conta"] == prof][:2]
        for r in ex:
            sample_lines.append(f"## [{prof}] {r['Nome']} ({r['Responsável']} — {r['Cargo do responsável'] or 'Sem cargo'})")
            sample_lines.append(f"- **Prioridade:** {r['Prioridade']} ({r['Pontuação']} pts) | **Etapa:** {r['Etapa']}")
            sample_lines.append(f"\n{r['Gancho']}\n")
    AMOSTRA_OUT.write_text("\n".join(sample_lines), encoding="utf-8")

    print("=== ETAPA 3 CONCLUÍDA ===")
    print(f"Total na Base Única: {len(rows_out)}")
    print(f"Concorrentes removidos: {len(concorrentes)}")
    print(f"CSV: {CSV_OUT}")
    print(f"XLSX: {XLSX_OUT}")


if __name__ == "__main__":
    main()

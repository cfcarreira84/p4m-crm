#!/usr/bin/env python3
"""Etapa 1: Limpeza determinística e consolidação por empresa/domínio da base P4M."""

import csv
import json
import re
from collections import defaultdict
from pathlib import Path

BASE_DIR = Path(r"D:\OneDrive\Documentos\202609_Projetos\P4M")
BRUTO_DIR = BASE_DIR / "bruto"
OUT_DIR = BASE_DIR / "higienizado"
OUT_DIR.mkdir(parents=True, exist_ok=True)

CRM_CSV = BRUTO_DIR / "Cópia de CRM-P4m FII - Real - CRM Central.csv"
LI_CSV = BRUTO_DIR / "Cópia de BD IA SDR LinkeIn - P4m - Prospecção.csv"

FREE_DOMAINS = {
    "gmail.com", "hotmail.com", "yahoo.com", "yahoo.com.br", "outlook.com",
    "uol.com.br", "bol.com.br", "terra.com.br", "ig.com.br", "icloud.com",
    "live.com", "msn.com", "globo.com", "me.com", "ymail.com",
    "protonmail.com", "proton.me", "aol.com", "zoho.com", "r7.com", "zipmail.com.br",
}

VALID_BR_DDDS = {
    "11","12","13","14","15","16","17","18","19",
    "21","22","24","27","28",
    "31","32","33","34","35","37","38",
    "41","42","43","44","45","46","47","48","49",
    "51","53","54","55",
    "61","62","63","64","65","66","67","68","69",
    "71","73","74","75","77","79",
    "81","82","83","84","85","86","87","88","89",
    "91","92","93","94","95","96","97","98","99",
}

DDD_TO_CITY_UF = {
    "11": ("São Paulo", "SP"), "12": ("São José dos Campos", "SP"), "13": ("Santos", "SP"),
    "14": ("Bauru", "SP"), "15": ("Sorocaba", "SP"), "16": ("Ribeirão Preto", "SP"),
    "17": ("São José do Rio Preto", "SP"), "18": ("Presidente Prudente", "SP"), "19": ("Campinas", "SP"),
    "21": ("Rio de Janeiro", "RJ"), "22": ("Campos dos Goytacazes", "RJ"), "24": ("Petrópolis", "RJ"),
    "27": ("Vitória", "ES"), "28": ("Cachoeiro de Itapemirim", "ES"),
    "31": ("Belo Horizonte", "MG"), "32": ("Juiz de Fora", "MG"), "34": ("Uberlândia", "MG"),
    "41": ("Curitiba", "PR"), "43": ("Londrina", "PR"), "44": ("Maringá", "PR"),
    "47": ("Joinville", "SC"), "48": ("Florianópolis", "SC"),
    "51": ("Porto Alegre", "RS"), "54": ("Caxias do Sul", "RS"),
    "61": ("Brasília", "DF"), "62": ("Goiânia", "GO"), "65": ("Cuiabá", "MT"), "67": ("Campo Grande", "MS"),
    "71": ("Salvador", "BA"), "81": ("Recife", "PE"), "85": ("Fortaleza", "CE"),
    "91": ("Belém", "PA"), "92": ("Manaus", "AM"),
}

SENIORITY_PATTERNS = [
    (100, re.compile(r"\b(ceo|cfo|coo|cmo|cto|cro|founder|co-founder|fundador|s[óo]cio|owner|propriet[áa]rio|presidente|vp|vice[- ]presidente)\b", re.I)),
    (85, re.compile(r"\b(diretor|director|head|superintendente|partner)\b", re.I)),
    (70, re.compile(r"\b(gerente|manager|lead|l[íi]der|executivo de contas|account executive)\b", re.I)),
    (55, re.compile(r"\b(coordenador|coordinator|supervisor|especialista|specialist)\b", re.I)),
    (40, re.compile(r"\b(analista|analyst|pleno|s[êe]nior|sr\.?|consultor)\b", re.I)),
    (20, re.compile(r"\b(assistente|auxiliar|j[úu]nior|jr\.?|estagi[áa]rio|intern)\b", re.I)),
]


def clean_str(val: str) -> str:
    if not val:
        return ""
    s = re.sub(r"\s+", " ", val.strip())
    if s.lower() in {"nan", "none", "null", "n/a", "-", "não publicado", "nao publicado"}:
        return ""
    return s


def parse_phone_br(raw: str):
    """Retorna (tipo, e164, ddd, obs) onde tipo in ('whatsapp', 'fixo', 'outro', '')."""
    s = clean_str(raw)
    if not s:
        return "", "", "", ""
    digits = re.sub(r"\D", "", s)
    if digits.startswith("55") and len(digits) in (12, 13):
        digits = digits[2:]
    if len(digits) in (10, 11) and digits[:2] in VALID_BR_DDDS:
        ddd = digits[:2]
        if len(digits) == 11 and digits[2] == "9":
            return "whatsapp", f"+55{digits}", ddd, ""
        if len(digits) == 10 and digits[2] in "6789":
            return "whatsapp", f"+55{digits}", ddd, ""
        if len(digits) == 10 and digits[2] in "2345":
            return "fixo", f"+55{digits}", ddd, ""
    return "outro", "", "", f"Telefone fora do padrão BR: {s}"


def seniority_score(cargo: str, has_phone: bool, raw_prio: str) -> int:
    score = 10
    if cargo:
        for pts, pat in SENIORITY_PATTERNS:
            if pat.search(cargo):
                score = max(score, pts)
                break
    if has_phone:
        score += 15
    if raw_prio.lower() == "alta":
        score += 5
    return score


def domain_to_prelim_name(domain: str) -> str:
    base = domain.split(".")[0]
    base = re.sub(r"[-_]+", " ", base).strip()
    if len(base) <= 4:
        return base.upper()
    return base.title()


def main():
    # 1. Carregar LinkedIn CSV para lookup de URLs e exportar linkedin_manual.csv
    li_lookup = {}
    li_manual = []
    with open(LI_CSV, "r", encoding="utf-8-sig", errors="replace") as f:
        for row in csv.DictReader(f):
            nome = clean_str(row.get("Nome ", ""))
            cargo = clean_str(row.get("Cargo", ""))
            empresa = clean_str(row.get("Empresa", ""))
            url = clean_str(row.get("URL do Perfil", ""))
            status = clean_str(row.get("Status", ""))
            vertical = clean_str(row.get("Vertical / Nicho", ""))
            if nome and url:
                li_lookup[nome.lower()] = url
            if status in ("", "🔥 Perfil Estratégico") and nome:
                li_manual.append({
                    "Nome": nome,
                    "Cargo": cargo,
                    "Empresa": empresa,
                    "URL do Perfil": url,
                    "Status": status or "Novo",
                    "Vertical / Nicho": vertical,
                })

    with open(OUT_DIR / "linkedin_manual.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["Nome", "Cargo", "Empresa", "URL do Perfil", "Status", "Vertical / Nicho"])
        w.writeheader()
        w.writerows(li_manual)

    # 2. Carregar CRM Central e filtrar descartáveis
    stats = defaultdict(int)
    corp_groups = defaultdict(list)
    network_list = []

    with open(CRM_CSV, "r", encoding="utf-8-sig", errors="replace") as f:
        for row in csv.DictReader(f):
            stats["crm_total"] += 1
            status = clean_str(row.get("Status", ""))
            if status != "Novo":
                stats[f"descartado_status_{status or 'vazio'}"] += 1
                continue

            nome = clean_str(row.get("Nome Completo", ""))
            cargo = clean_str(row.get("Cargo", ""))
            empresa = clean_str(row.get("Empresa", ""))
            email = clean_str(row.get("E-mail", "")).lower()
            raw_phone = clean_str(row.get("WhatsApp / Telefone", ""))
            raw_prio = clean_str(row.get("Nível de Prioridade", ""))
            origem = clean_str(row.get("Origem (Fonte)", ""))

            # Corrigir anomalia Empresa == Cargo
            if cargo and empresa and cargo.lower() == empresa.lower():
                empresa = ""
                stats["corrigido_empresa_igual_cargo"] += 1

            # Limpar prioridade vazada
            prio_clean = raw_prio if raw_prio.lower() in {"alta", "média", "media", "baixa", "frio"} else ""
            if raw_prio and not prio_clean:
                stats["limpo_prioridade_vazada"] += 1

            phone_type, phone_e164, ddd, phone_obs = parse_phone_br(raw_phone)
            li_url = li_lookup.get(nome.lower(), "") if nome else ""

            dom = email.split("@")[-1] if "@" in email else ""
            contact = {
                "nome": nome,
                "cargo": cargo,
                "empresa_bruta": empresa,
                "email": email,
                "phone_type": phone_type,
                "phone_e164": phone_e164,
                "raw_phone": raw_phone,
                "ddd": ddd,
                "phone_obs": phone_obs,
                "prio_bruta": prio_clean,
                "origem": origem,
                "linkedin_url": li_url,
            }

            if dom and dom not in FREE_DOMAINS:
                corp_groups[dom].append(contact)
                stats["novo_corporativo"] += 1
            else:
                network_list.append(contact)
                stats["novo_network"] += 1

    # 3. Consolidar grupos corporativos (1 card = 1 Empresa)
    empresas_consolidadas = []
    for dom, contacts in sorted(corp_groups.items()):
        # Ordenar por senioridade decrescente
        contacts_sorted = sorted(
            contacts,
            key=lambda c: seniority_score(c["cargo"], bool(c["phone_e164"]), c["prio_bruta"]),
            reverse=True,
        )
        primary = contacts_sorted[0]

        # Melhor empresa_bruta disponível no grupo
        emp_names = [c["empresa_bruta"] for c in contacts_sorted if c["empresa_bruta"]]
        empresa_bruta = emp_names[0] if emp_names else domain_to_prelim_name(dom)

        # Melhor telefone whatsapp e fixo do grupo
        wa_e164 = next((c["phone_e164"] for c in contacts_sorted if c["phone_type"] == "whatsapp"), "")
        fixo_e164 = next((c["phone_e164"] for c in contacts_sorted if c["phone_type"] == "fixo"), "")
        outros_tel = [c["raw_phone"] for c in contacts_sorted if c["phone_type"] == "outro" and c["raw_phone"]]
        ddd_best = next((c["ddd"] for c in contacts_sorted if c["ddd"]), "")
        cidade_ddd, uf_ddd = DDD_TO_CITY_UF.get(ddd_best, ("", ""))

        # Outros contatos formatados com LinkedIn
        outros_fmt = []
        for c in contacts_sorted[1:15]:  # limita a 14 secundários para não estourar célula
            parts = [c["nome"] or "Sem nome"]
            if c["cargo"]:
                parts.append(c["cargo"])
            if c["email"]:
                parts.append(c["email"])
            if c["phone_e164"] or c["raw_phone"]:
                parts.append(c["phone_e164"] or c["raw_phone"])
            if c["linkedin_url"]:
                parts.append(c["linkedin_url"])
            outros_fmt.append(" | ".join(parts))

        empresas_consolidadas.append({
            "dominio": dom,
            "empresa_bruta": empresa_bruta,
            "site": f"https://{dom}",
            "contato_principal": primary["nome"] or "Equipe",
            "cargo_principal": primary["cargo"],
            "email_principal": primary["email"],
            "linkedin_principal": primary["linkedin_url"],
            "whatsapp_e164": wa_e164,
            "fixo_e164": fixo_e164,
            "outros_telefones": "; ".join(dict.fromkeys(outros_tel)),
            "cidade_ddd": cidade_ddd,
            "uf_ddd": uf_ddd,
            "prio_bruta": next((c["prio_bruta"] for c in contacts_sorted if c["prio_bruta"]), ""),
            "qtd_contatos": len(contacts_sorted),
            "outros_contatos": "\n".join(outros_fmt),
            "origem_bruta": primary["origem"],
            "cargos_amostra": list(dict.fromkeys(c["cargo"] for c in contacts_sorted if c["cargo"]))[:5],
        })

    # Salvar intermediários JSON
    (OUT_DIR / "intermediario_empresas.json").write_text(
        json.dumps(empresas_consolidadas, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT_DIR / "intermediario_network.json").write_text(
        json.dumps(network_list, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT_DIR / "stats_etapa1.json").write_text(
        json.dumps(dict(stats), ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print("=== ETAPA 1 CONCLUÍDA ===")
    print("Stats:", json.dumps(dict(stats), ensure_ascii=False, indent=2))
    print("Empresas únicas consolidadas:", len(empresas_consolidadas))
    print("Network (e-mails pessoais):", len(network_list))
    print("LinkedIn manual exportado:", len(li_manual))


if __name__ == "__main__":
    main()

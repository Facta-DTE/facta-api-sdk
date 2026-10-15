# Official catalogs (Ministerio de Hacienda, DTE v1.2)

Verbatim copies of the Ministry's catalogs, as vendored in the Facta DTE application
(`apps/web/src/screens/onboarding/catalogs/`, themselves downloaded from the MH portal factura.gob.sv):

- `cat-012-departamento.json` — CAT-012 Departamento
- `cat-013-municipio.json` — CAT-013 Municipio (post-2024 division)
- `cat-019-actividad-economica.json` — CAT-019 Actividad económica (774 rows)
- `cat-020-pais.json` — CAT-020 País

The playground loads them lazily (dynamic import) only when «Personalizado» is opened. Do not edit them by hand.

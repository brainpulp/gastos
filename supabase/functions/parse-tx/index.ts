import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS_ORIGIN = 'https://brainpulp.github.io'
const corsHeaders = {
  'Access-Control-Allow-Origin': CORS_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SYSTEM = `Sos un parser de gastos personales en español rioplatense. Convertís una frase libre
en UNA transacción estructurada. Respondé SOLO con JSON válido, sin texto extra, con esta forma exacta:
{"amount": <number>, "currency": "ARS"|"USD", "direction": "expense"|"income",
 "cat": "<una categoría de la lista, o null>", "bank": "Cash"|"Santander"|"Citibank"|"BofA"|"Chase"|"Wells Fargo",
 "merchant": "<etiqueta corta>", "date": "YYYY-MM-DD", "needs_review": <bool>, "note": "<aclaración breve>"}

Reglas:
- Montos: "20 mil"/"20.000"/"20k" => 20000 ; "2 lucas" => 2000 ; "dos mil dólares" => 2000 USD.
- Moneda: ARS por defecto; USD solo si dice dólares/usd/u$s/verdes.
- Banco: "Cash" (efectivo) por defecto, salvo que mencione un banco/tarjeta.
- Fecha: usá TODAY salvo que diga "ayer"/"el 3"/una fecha; devolvé YYYY-MM-DD.
- direction: "expense" salvo que claramente sea ingreso (cobré, me pagaron, ingreso).
- Elegí cat SOLO de la lista provista. Pistas usuales: veterinaria/vet=>pets; estacionamiento/parking=>transportation;
  nafta/combustible/ypf/axion/shell=>Gas; super/supermercado/almacén/carnicería=>Food; resto/café/bar/parrilla=>Dining;
  farmacia/médico/osde=>Healthcare; "carhué"/"carué"/madera para carhué=>"Carhué obra";
  alquiler/contribución a sol/uni de andrés=>"contribution to Sol"; luz/gas/agua/internet/edenor/aysa/naturgy/personal=>"Home utilities";
  impuestos/afip/arca=>"AR taxes".
- Si no estás razonablemente seguro de la categoría, poné cat=null y needs_review=true.
- note: una línea con lo que dedujiste o la duda (ej: "asumí ARS y efectivo").`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
  const token = authHeader.slice(7)
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  )
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  let body: any
  try { body = await req.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
  const text = String(body.text || '').trim()
  const today = String(body.today || new Date().toISOString().slice(0, 10))
  const categories: string[] = Array.isArray(body.categories) ? body.categories : []
  if (!text) {
    return new Response(JSON.stringify({ error: 'Missing text' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!anthropicKey) {
    return new Response(JSON.stringify({ error: 'Server misconfiguration: missing API key' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const userMsg = `TODAY=${today}\nCategorías disponibles: ${categories.join(', ')}\n\nFrase: "${text}"`

  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5', max_tokens: 400, system: SYSTEM,
        messages: [{ role: 'user', content: userMsg }],
      }),
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: `Network error calling Claude: ${e}` }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
  if (!res.ok) {
    const errText = await res.text()
    return new Response(JSON.stringify({ error: `Claude API error ${res.status}: ${errText}` }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
  const data = await res.json()
  let content = data.content?.[0]?.text ?? ''
  // strip code fences if present
  content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  let parsed: any
  try { parsed = JSON.parse(content) } catch {
    return new Response(JSON.stringify({ error: `Could not parse Claude response: ${content}` }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
  // guard: cat must be in the list (or null)
  if (parsed.cat && categories.length && !categories.includes(parsed.cat)) {
    parsed.needs_review = true
  }
  parsed.usage = {
    input_tokens: data.usage?.input_tokens ?? 0,
    output_tokens: data.usage?.output_tokens ?? 0,
  }
  return new Response(JSON.stringify(parsed),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})

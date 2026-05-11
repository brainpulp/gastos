import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS_ORIGIN = 'https://brainpulp.github.io'

const corsHeaders = {
  'Access-Control-Allow-Origin': CORS_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  // Validate JWT
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const token = authHeader.slice(7)
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  )

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Parse request body
  let body: { merchant?: string; rawDesc?: string; amount?: number; availableCategories?: string[] }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { merchant, rawDesc, amount, availableCategories = [] } = body

  // Call Anthropic API
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!anthropicKey) {
    return new Response(JSON.stringify({ error: 'Server misconfiguration: missing API key' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const systemPrompt = `You are a personal finance transaction categorizer.
Given a bank transaction, return the most appropriate category from the list provided.
Respond with ONLY valid JSON in this exact shape:
{"cat": "<category>", "confidence": <0.0-1.0>, "reasoning": "<brief reason>"}`

  const userMsg = `Transaction:
- Merchant: ${merchant || '(none)'}
- Description: ${rawDesc || '(none)'}
- Amount (ARS): ${amount ?? '(unknown)'}

Available categories: ${availableCategories.join(', ')}

Pick the single best matching category.`

  let anthropicRes: Response
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 200,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }],
      }),
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: `Network error calling Claude: ${e}` }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text()
    return new Response(JSON.stringify({ error: `Claude API error ${anthropicRes.status}: ${errText}` }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const anthropicData = await anthropicRes.json()
  const content = anthropicData.content?.[0]?.text ?? ''

  let parsed: { cat: string; confidence: number; reasoning: string }
  try {
    parsed = JSON.parse(content)
  } catch {
    return new Response(JSON.stringify({ error: `Could not parse Claude response: ${content}` }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(
    JSON.stringify({
      cat: parsed.cat,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
      usage: {
        prompt_tokens: anthropicData.usage?.input_tokens ?? 0,
        completion_tokens: anthropicData.usage?.output_tokens ?? 0,
        model: anthropicData.model ?? 'claude-haiku-4-5',
      },
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})

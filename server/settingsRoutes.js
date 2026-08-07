const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const authMiddleware = require('./auth-middleware');

let supabase2Instance = null;

function getSupabaseClient(req) {
  if (supabase2Instance) return supabase2Instance;

  const supabaseUrl2 = process.env.SUPABASE_URL_2 || process.env.SUPABASE_URL;
  const supabaseKey2 = process.env.SUPABASE_SECRET_KEY_2 || process.env.SUPABASE_SERVICE_ROLE_KEY_2 || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

  if (supabaseUrl2 && supabaseKey2) {
    try {
      supabase2Instance = createClient(supabaseUrl2, supabaseKey2);
      console.log('Supabase Client 2 (Settings DB) initialized successfully');
      return supabase2Instance;
    } catch (e) {
      console.error('Failed to create Supabase Client 2:', e.message);
    }
  }
  return req.app.locals.supabase;
}

// GET /api/settings - Fetch all settings for the logged in user
router.get('/', authMiddleware, async (req, res) => {
  const supabase = getSupabaseClient(req);
  if (!supabase) {
    return res.status(500).json({ error: 'Supabase database client not available' });
  }

  try {
    const { data: userSettings, error } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', String(req.userId))
      .maybeSingle();

    if (error) throw error;

    res.json({
      success: true,
      settings: userSettings ? userSettings.preferences : null
    });
  } catch (err) {
    console.error('Fetch user settings error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve user settings' });
  }
});

// PUT /api/settings - Update or insert user settings for the logged in user
router.put('/', authMiddleware, async (req, res) => {
  const supabase = getSupabaseClient(req);
  if (!supabase) {
    return res.status(500).json({ error: 'Supabase database client not available' });
  }

  const { preferences } = req.body;
  if (!preferences || typeof preferences !== 'object') {
    return res.status(400).json({ error: 'Invalid settings payload. Expected "preferences" object.' });
  }

  try {
    const payload = {
      user_id: String(req.userId),
      preferences: preferences,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('user_settings')
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: 'User settings saved successfully to database',
      settings: data.preferences
    });
  } catch (err) {
    console.error('Save user settings error:', err.message);
    res.status(500).json({ error: 'Failed to save user settings' });
  }
});

// POST /api/settings/reset - Reset user settings to defaults
router.post('/reset', authMiddleware, async (req, res) => {
  const supabase = getSupabaseClient(req);
  if (!supabase) {
    return res.status(500).json({ error: 'Supabase database client not available' });
  }

  try {
    const { error } = await supabase
      .from('user_settings')
      .delete()
      .eq('user_id', req.userId);

    if (error) throw error;

    res.json({
      success: true,
      message: 'User settings reset to defaults'
    });
  } catch (err) {
    console.error('Reset user settings error:', err.message);
    res.status(500).json({ error: 'Failed to reset user settings' });
  }
});

module.exports = router;

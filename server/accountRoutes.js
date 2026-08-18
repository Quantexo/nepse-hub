const express = require('express');
const router = express.Router();
const authMiddleware = require('./auth-middleware');
const { verifyPassword } = require('./auth-utils');
const { createClient } = require('@supabase/supabase-js');

// Helper to get Supabase Client 2 (for user_settings and auxiliary data if configured)
function getSupabaseClient2() {
  const supabaseUrl2 = process.env.SUPABASE_URL_2 || process.env.SUPABASE_URL;
  const supabaseKey2 = process.env.SUPABASE_SECRET_KEY_2 || process.env.SUPABASE_SERVICE_ROLE_KEY_2 || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (supabaseUrl2 && supabaseKey2) {
    try {
      return createClient(supabaseUrl2, supabaseKey2);
    } catch (e) {
      console.warn('Failed to init Supabase client 2 in accountRoutes:', e.message);
    }
  }
  return null;
}

// ─── PUT /api/account/email: Change User Email ───
router.put('/email', authMiddleware, async (req, res) => {
  const { newEmail, currentPassword } = req.body;
  const supabase = req.app.locals.supabase;

  if (!newEmail || !currentPassword) {
    return res.status(400).json({ error: 'New email and current password are required.' });
  }

  const normalizedEmail = newEmail.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Invalid email address format.' });
  }

  try {
    // 1. Fetch current user record to verify password
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, password_hash, email')
      .eq('id', req.userId)
      .maybeSingle();

    if (userError) throw userError;
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // 2. Verify current password
    const isMatch = await verifyPassword(currentPassword, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Incorrect current password.' });
    }

    // 3. Check if email is already in use by another user
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('id')
      .eq('email', normalizedEmail)
      .neq('id', req.userId)
      .maybeSingle();

    if (checkError) throw checkError;
    if (existingUser) {
      return res.status(409).json({ error: 'Email is already registered with another account.' });
    }

    // 4. Update email
    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update({ email: normalizedEmail, updated_at: new Date().toISOString() })
      .eq('id', req.userId)
      .select('id, code, email, username')
      .single();

    if (updateError) throw updateError;

    res.json({
      success: true,
      message: 'Email updated successfully.',
      user: updatedUser
    });
  } catch (err) {
    console.error('Change email error:', err.message);
    res.status(500).json({ error: 'Failed to update email address.' });
  }
});

// ─── GET /api/account/export: Export All User Data (JSON or CSV) ───
router.get('/export', authMiddleware, async (req, res) => {
  const supabase = req.app.locals.supabase;
  const supabase2 = getSupabaseClient2() || supabase;
  const format = (req.query.format || 'json').toLowerCase();

  try {
    // Fetch all user data in parallel
    const [
      userRes,
      watchlistRes,
      transactionsRes,
      tradePlansRes,
      notificationsRes,
      settingsRes
    ] = await Promise.all([
      supabase.from('users').select('id, code, username, email, created_at').eq('id', req.userId).maybeSingle(),
      supabase.from('watchlist').select('*').eq('user_id', req.userId),
      supabase.from('transactions').select('*').eq('user_id', req.userId).order('transaction_date', { ascending: false }),
      supabase.from('trade_plans').select('*').eq('user_id', req.userId),
      supabase.from('notifications').select('*').eq('user_id', req.userId).order('created_at', { ascending: false }),
      supabase2.from('user_settings').select('*').eq('user_id', String(req.userId)).maybeSingle()
    ]);

    const exportData = {
      exported_at: new Date().toISOString(),
      user: userRes.data || {},
      settings: settingsRes.data?.preferences || {},
      watchlist: watchlistRes.data || [],
      transactions: transactionsRes.data || [],
      trade_plans: tradePlansRes.data || [],
      notifications: notificationsRes.data || []
    };

    if (format === 'csv') {
      const helperToCSV = (data, columns) => {
        if (!data || data.length === 0) return 'No records found\n';
        const header = columns.join(',');
        const rows = data.map(row =>
          columns.map(col => {
            let val = row[col] ?? '';
            if (typeof val === 'object') val = JSON.stringify(val);
            val = String(val);
            if (val.includes(',') || val.includes('"') || val.includes('\n')) {
              val = `"${val.replace(/"/g, '""')}"`;
            }
            return val;
          }).join(',')
        );
        return [header, ...rows].join('\n') + '\n';
      };

      let csv = `\uFEFFNEPSE HUB USER DATA EXPORT\n`;
      csv += `Exported At: ${exportData.exported_at}\n`;
      csv += `User: ${exportData.user.username || ''} (${exportData.user.code || ''}) | Email: ${exportData.user.email || ''}\n\n`;

      csv += `=== TRANSACTIONS ===\n`;
      csv += helperToCSV(exportData.transactions, [
        'symbol', 'type', 'quantity', 'price', 'transaction_date',
        'broker_commission', 'sebon_fee', 'dp_charge', 'stop_loss', 'source'
      ]);

      csv += `\n=== WATCHLIST ===\n`;
      csv += helperToCSV(exportData.watchlist, ['symbol', 'target_buy', 'target_sell', 'notes', 'created_at']);

      csv += `\n=== TRADE PLANS ===\n`;
      csv += helperToCSV(exportData.trade_plans, ['symbol', 'entry_price', 'target_price', 'stop_loss', 'quantity', 'status', 'notes', 'created_at']);

      csv += `\n=== NOTIFICATIONS ===\n`;
      csv += helperToCSV(exportData.notifications, ['type', 'symbol', 'title', 'message', 'is_read', 'created_at']);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=nepsehub_export_${Date.now()}.csv`);
      return res.send(csv);
    }

    // Default JSON
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=nepsehub_export_${Date.now()}.json`);
    return res.json(exportData);

  } catch (err) {
    console.error('Account export error:', err.message);
    res.status(500).json({ error: 'Failed to export account data' });
  }
});

// ─── DELETE /api/account: Wipe All User Data & Delete Account ───
router.delete('/', authMiddleware, async (req, res) => {
  const supabase = req.app.locals.supabase;
  const supabase2 = getSupabaseClient2() || supabase;
  const userId = req.userId;

  try {
    // 1. Delete associated data across all DB tables
    await Promise.allSettled([
      supabase.from('watchlist').delete().eq('user_id', userId),
      supabase.from('transactions').delete().eq('user_id', userId),
      supabase.from('trade_plans').delete().eq('user_id', userId),
      supabase.from('notifications').delete().eq('user_id', userId),
      supabase2.from('user_settings').delete().eq('user_id', String(userId))
    ]);

    // 2. Delete user account record
    const { error: deleteUserError } = await supabase
      .from('users')
      .delete()
      .eq('id', userId);

    if (deleteUserError) throw deleteUserError;

    // 3. Clear auth cookies
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/api/auth'
    });

    res.json({
      success: true,
      message: 'Account and all associated records permanently deleted.'
    });
  } catch (err) {
    console.error('Delete account error:', err.message);
    res.status(500).json({ error: 'Failed to completely delete account.' });
  }
});

module.exports = router;

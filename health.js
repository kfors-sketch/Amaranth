module.exports = (req, res) => {
  res.status(200).json({
    ok: true,
    node: process.version,
    hasStripeKey: !!process.env.STRIPE_SECRET_KEY,
    hasReportToken: !!process.env.REPORT_TOKEN,
    env: process.env.VERCEL_ENV || 'unknown' // 'development' | 'preview' | 'production'
  });
};
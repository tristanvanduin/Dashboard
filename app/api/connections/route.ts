/**
 * Returns connection status for all configured APIs.
 * Used by the settings page to show which integrations are active.
 */
export async function GET() {
  const googleAds = {
    configured: !!(
      process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
      process.env.GOOGLE_ADS_CLIENT_ID &&
      process.env.GOOGLE_ADS_CLIENT_SECRET &&
      process.env.GOOGLE_ADS_REFRESH_TOKEN
    ),
    hasManagerId: !!process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID,
  };

  const metaAds = {
    configured: !!process.env.META_ADS_ACCESS_TOKEN,
    hasAppCredentials: !!(process.env.META_ADS_APP_ID && process.env.META_ADS_APP_SECRET),
  };

  return Response.json({
    googleAds,
    metaAds,
    anyConnected: googleAds.configured || metaAds.configured,
  });
}

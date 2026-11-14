import { Router } from 'express';
const router = Router();
// Removed permanently: no provider imports, credentials or outbound requests.
router.use((_req, res) => res.status(410).json({ error: 'ИИ-ассистент отключён' }));
export default router;

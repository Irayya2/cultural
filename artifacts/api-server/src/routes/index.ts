import { Router, type IRouter } from 'express';
import healthRouter from './health';
import otpRouter from './otp';
import teacherRouter from './teacher';
import studentRouter from './student';

const router: IRouter = Router();

router.use(healthRouter);
router.use(otpRouter);
router.use(teacherRouter);
router.use(studentRouter);

export default router;

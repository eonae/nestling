/* СГЕНЕРИРОВАНО type-tests/bench/generate.ts — не редактировать */
/* eslint-disable */
import type {
  AnyInput,
  FailDefinitionWithoutDetails,
  PreUnitFn,
  UnitResolver,
} from '@nestling/pipeline';
import { compose, makePipeline, Ok } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';

declare const resolve: UnitResolver;

declare const u0: PreUnitFn<AnyInput, { f0: string }>;
declare const f0Fail: FailDefinitionWithoutDetails<'conflict:bench_a'>;
const l0 = makePipeline().pre(u0, { errors: [f0Fail] });
declare const u1: PreUnitFn<AnyInput, { f1: string }>;
declare const f1Fail: FailDefinitionWithoutDetails<'conflict:bench_b'>;
const l1 = makePipeline<{ f0: string }>().pre(u1, { errors: [f1Fail] });
declare const u2: PreUnitFn<AnyInput, { f2: string }>;
declare const f2Fail: FailDefinitionWithoutDetails<'conflict:bench_c'>;
const l2 = makePipeline<{ f1: string }>().pre(u2, { errors: [f2Fail] });
declare const u3: PreUnitFn<AnyInput, { f3: string }>;
declare const f3Fail: FailDefinitionWithoutDetails<'conflict:bench_d'>;
const l3 = makePipeline<{ f2: string }>().pre(u3, { errors: [f3Fail] });
declare const u4: PreUnitFn<AnyInput, { f4: string }>;
declare const f4Fail: FailDefinitionWithoutDetails<'conflict:bench_e'>;
const l4 = makePipeline<{ f3: string }>().pre(u4, { errors: [f4Fail] });
declare const u5: PreUnitFn<AnyInput, { f5: string }>;
declare const f5Fail: FailDefinitionWithoutDetails<'conflict:bench_f'>;
const l5 = makePipeline<{ f4: string }>().pre(u5, { errors: [f5Fail] });
declare const u6: PreUnitFn<AnyInput, { f6: string }>;
declare const f6Fail: FailDefinitionWithoutDetails<'conflict:bench_g'>;
const l6 = makePipeline<{ f5: string }>().pre(u6, { errors: [f6Fail] });
declare const u7: PreUnitFn<AnyInput, { f7: string }>;
declare const f7Fail: FailDefinitionWithoutDetails<'conflict:bench_h'>;
const l7 = makePipeline<{ f6: string }>().pre(u7, { errors: [f7Fail] });
declare const u8: PreUnitFn<AnyInput, { f8: string }>;
declare const f8Fail: FailDefinitionWithoutDetails<'conflict:bench_i'>;
const l8 = makePipeline<{ f7: string }>().pre(u8, { errors: [f8Fail] });
declare const u9: PreUnitFn<AnyInput, { f9: string }>;
declare const f9Fail: FailDefinitionWithoutDetails<'conflict:bench_j'>;
const l9 = makePipeline<{ f8: string }>().pre(u9, { errors: [f9Fail] });
declare const u10: PreUnitFn<AnyInput, { f10: string }>;
declare const f10Fail: FailDefinitionWithoutDetails<'conflict:bench_k'>;
const l10 = makePipeline<{ f9: string }>().pre(u10, { errors: [f10Fail] });
declare const u11: PreUnitFn<AnyInput, { f11: string }>;
declare const f11Fail: FailDefinitionWithoutDetails<'conflict:bench_l'>;
const l11 = makePipeline<{ f10: string }>().pre(u11, { errors: [f11Fail] });
declare const u12: PreUnitFn<AnyInput, { f12: string }>;
declare const f12Fail: FailDefinitionWithoutDetails<'conflict:bench_m'>;
const l12 = makePipeline<{ f11: string }>().pre(u12, { errors: [f12Fail] });
declare const u13: PreUnitFn<AnyInput, { f13: string }>;
declare const f13Fail: FailDefinitionWithoutDetails<'conflict:bench_n'>;
const l13 = makePipeline<{ f12: string }>().pre(u13, { errors: [f13Fail] });
declare const u14: PreUnitFn<AnyInput, { f14: string }>;
declare const f14Fail: FailDefinitionWithoutDetails<'conflict:bench_o'>;
const l14 = makePipeline<{ f13: string }>().pre(u14, { errors: [f14Fail] });
declare const u15: PreUnitFn<AnyInput, { f15: string }>;
declare const f15Fail: FailDefinitionWithoutDetails<'conflict:bench_p'>;
const l15 = makePipeline<{ f14: string }>().pre(u15, { errors: [f15Fail] });
declare const u16: PreUnitFn<AnyInput, { f16: string }>;
declare const f16Fail: FailDefinitionWithoutDetails<'conflict:bench_q'>;
const l16 = makePipeline<{ f15: string }>().pre(u16, { errors: [f16Fail] });
declare const u17: PreUnitFn<AnyInput, { f17: string }>;
declare const f17Fail: FailDefinitionWithoutDetails<'conflict:bench_r'>;
const l17 = makePipeline<{ f16: string }>().pre(u17, { errors: [f17Fail] });
declare const u18: PreUnitFn<AnyInput, { f18: string }>;
declare const f18Fail: FailDefinitionWithoutDetails<'conflict:bench_s'>;
const l18 = makePipeline<{ f17: string }>().pre(u18, { errors: [f18Fail] });
declare const u19: PreUnitFn<AnyInput, { f19: string }>;
declare const f19Fail: FailDefinitionWithoutDetails<'conflict:bench_t'>;
const l19 = makePipeline<{ f18: string }>().pre(u19, { errors: [f19Fail] });
declare const u20: PreUnitFn<AnyInput, { f20: string }>;
declare const f20Fail: FailDefinitionWithoutDetails<'conflict:bench_u'>;
const l20 = makePipeline<{ f19: string }>().pre(u20, { errors: [f20Fail] });
declare const u21: PreUnitFn<AnyInput, { f21: string }>;
declare const f21Fail: FailDefinitionWithoutDetails<'conflict:bench_v'>;
const l21 = makePipeline<{ f20: string }>().pre(u21, { errors: [f21Fail] });
declare const u22: PreUnitFn<AnyInput, { f22: string }>;
declare const f22Fail: FailDefinitionWithoutDetails<'conflict:bench_w'>;
const l22 = makePipeline<{ f21: string }>().pre(u22, { errors: [f22Fail] });
declare const u23: PreUnitFn<AnyInput, { f23: string }>;
declare const f23Fail: FailDefinitionWithoutDetails<'conflict:bench_x'>;
const l23 = makePipeline<{ f22: string }>().pre(u23, { errors: [f23Fail] });
declare const u24: PreUnitFn<AnyInput, { f24: string }>;
declare const f24Fail: FailDefinitionWithoutDetails<'conflict:bench_y'>;
const l24 = makePipeline<{ f23: string }>().pre(u24, { errors: [f24Fail] });
declare const u25: PreUnitFn<AnyInput, { f25: string }>;
declare const f25Fail: FailDefinitionWithoutDetails<'conflict:bench_z'>;
const l25 = makePipeline<{ f24: string }>().pre(u25, { errors: [f25Fail] });
declare const u26: PreUnitFn<AnyInput, { f26: string }>;
declare const f26Fail: FailDefinitionWithoutDetails<'conflict:bench_ba'>;
const l26 = makePipeline<{ f25: string }>().pre(u26, { errors: [f26Fail] });
declare const u27: PreUnitFn<AnyInput, { f27: string }>;
declare const f27Fail: FailDefinitionWithoutDetails<'conflict:bench_bb'>;
const l27 = makePipeline<{ f26: string }>().pre(u27, { errors: [f27Fail] });
declare const u28: PreUnitFn<AnyInput, { f28: string }>;
declare const f28Fail: FailDefinitionWithoutDetails<'conflict:bench_bc'>;
const l28 = makePipeline<{ f27: string }>().pre(u28, { errors: [f28Fail] });
declare const u29: PreUnitFn<AnyInput, { f29: string }>;
declare const f29Fail: FailDefinitionWithoutDetails<'conflict:bench_bd'>;
const l29 = makePipeline<{ f28: string }>().pre(u29, { errors: [f29Fail] });
declare const u30: PreUnitFn<AnyInput, { f30: string }>;
declare const f30Fail: FailDefinitionWithoutDetails<'conflict:bench_be'>;
const l30 = makePipeline<{ f29: string }>().pre(u30, { errors: [f30Fail] });
declare const u31: PreUnitFn<AnyInput, { f31: string }>;
declare const f31Fail: FailDefinitionWithoutDetails<'conflict:bench_bf'>;
const l31 = makePipeline<{ f30: string }>().pre(u31, { errors: [f31Fail] });
declare const u32: PreUnitFn<AnyInput, { f32: string }>;
declare const f32Fail: FailDefinitionWithoutDetails<'conflict:bench_bg'>;
const l32 = makePipeline<{ f31: string }>().pre(u32, { errors: [f32Fail] });
declare const u33: PreUnitFn<AnyInput, { f33: string }>;
declare const f33Fail: FailDefinitionWithoutDetails<'conflict:bench_bh'>;
const l33 = makePipeline<{ f32: string }>().pre(u33, { errors: [f33Fail] });
declare const u34: PreUnitFn<AnyInput, { f34: string }>;
declare const f34Fail: FailDefinitionWithoutDetails<'conflict:bench_bi'>;
const l34 = makePipeline<{ f33: string }>().pre(u34, { errors: [f34Fail] });
declare const u35: PreUnitFn<AnyInput, { f35: string }>;
declare const f35Fail: FailDefinitionWithoutDetails<'conflict:bench_bj'>;
const l35 = makePipeline<{ f34: string }>().pre(u35, { errors: [f35Fail] });
declare const u36: PreUnitFn<AnyInput, { f36: string }>;
declare const f36Fail: FailDefinitionWithoutDetails<'conflict:bench_bk'>;
const l36 = makePipeline<{ f35: string }>().pre(u36, { errors: [f36Fail] });
declare const u37: PreUnitFn<AnyInput, { f37: string }>;
declare const f37Fail: FailDefinitionWithoutDetails<'conflict:bench_bl'>;
const l37 = makePipeline<{ f36: string }>().pre(u37, { errors: [f37Fail] });
declare const u38: PreUnitFn<AnyInput, { f38: string }>;
declare const f38Fail: FailDefinitionWithoutDetails<'conflict:bench_bm'>;
const l38 = makePipeline<{ f37: string }>().pre(u38, { errors: [f38Fail] });
declare const u39: PreUnitFn<AnyInput, { f39: string }>;
declare const f39Fail: FailDefinitionWithoutDetails<'conflict:bench_bn'>;
const l39 = makePipeline<{ f38: string }>().pre(u39, { errors: [f39Fail] });
declare const u40: PreUnitFn<AnyInput, { f40: string }>;
declare const f40Fail: FailDefinitionWithoutDetails<'conflict:bench_bo'>;
const l40 = makePipeline<{ f39: string }>().pre(u40, { errors: [f40Fail] });
declare const u41: PreUnitFn<AnyInput, { f41: string }>;
declare const f41Fail: FailDefinitionWithoutDetails<'conflict:bench_bp'>;
const l41 = makePipeline<{ f40: string }>().pre(u41, { errors: [f41Fail] });
declare const u42: PreUnitFn<AnyInput, { f42: string }>;
declare const f42Fail: FailDefinitionWithoutDetails<'conflict:bench_bq'>;
const l42 = makePipeline<{ f41: string }>().pre(u42, { errors: [f42Fail] });
declare const u43: PreUnitFn<AnyInput, { f43: string }>;
declare const f43Fail: FailDefinitionWithoutDetails<'conflict:bench_br'>;
const l43 = makePipeline<{ f42: string }>().pre(u43, { errors: [f43Fail] });
declare const u44: PreUnitFn<AnyInput, { f44: string }>;
declare const f44Fail: FailDefinitionWithoutDetails<'conflict:bench_bs'>;
const l44 = makePipeline<{ f43: string }>().pre(u44, { errors: [f44Fail] });
declare const u45: PreUnitFn<AnyInput, { f45: string }>;
declare const f45Fail: FailDefinitionWithoutDetails<'conflict:bench_bt'>;
const l45 = makePipeline<{ f44: string }>().pre(u45, { errors: [f45Fail] });
declare const u46: PreUnitFn<AnyInput, { f46: string }>;
declare const f46Fail: FailDefinitionWithoutDetails<'conflict:bench_bu'>;
const l46 = makePipeline<{ f45: string }>().pre(u46, { errors: [f46Fail] });
declare const u47: PreUnitFn<AnyInput, { f47: string }>;
declare const f47Fail: FailDefinitionWithoutDetails<'conflict:bench_bv'>;
const l47 = makePipeline<{ f46: string }>().pre(u47, { errors: [f47Fail] });
declare const u48: PreUnitFn<AnyInput, { f48: string }>;
declare const f48Fail: FailDefinitionWithoutDetails<'conflict:bench_bw'>;
const l48 = makePipeline<{ f47: string }>().pre(u48, { errors: [f48Fail] });
declare const u49: PreUnitFn<AnyInput, { f49: string }>;
declare const f49Fail: FailDefinitionWithoutDetails<'conflict:bench_bx'>;
const l49 = makePipeline<{ f48: string }>().pre(u49, { errors: [f49Fail] });

export const composed = compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(compose(l0, l1), l2), l3), l4), l5), l6), l7), l8), l9), l10), l11), l12), l13), l14), l15), l16), l17), l18), l19), l20), l21), l22), l23), l24), l25), l26), l27), l28), l29), l30), l31), l32), l33), l34), l35), l36), l37), l38), l39), l40), l41), l42), l43), l44), l45), l46), l47), l48), l49);
export const e0 = httpEndpoint({
  method: 'GET',
  path: '/bench/0',
  pipeline: composed,
  handler: async () => new Ok({ n: 0 }),
});
export const e1 = httpEndpoint({
  method: 'GET',
  path: '/bench/1',
  pipeline: composed,
  handler: async () => new Ok({ n: 1 }),
});
export const e2 = httpEndpoint({
  method: 'GET',
  path: '/bench/2',
  pipeline: composed,
  handler: async () => new Ok({ n: 2 }),
});
export const e3 = httpEndpoint({
  method: 'GET',
  path: '/bench/3',
  pipeline: composed,
  handler: async () => new Ok({ n: 3 }),
});
export const e4 = httpEndpoint({
  method: 'GET',
  path: '/bench/4',
  pipeline: composed,
  handler: async () => new Ok({ n: 4 }),
});
export const e5 = httpEndpoint({
  method: 'GET',
  path: '/bench/5',
  pipeline: composed,
  handler: async () => new Ok({ n: 5 }),
});
export const e6 = httpEndpoint({
  method: 'GET',
  path: '/bench/6',
  pipeline: composed,
  handler: async () => new Ok({ n: 6 }),
});
export const e7 = httpEndpoint({
  method: 'GET',
  path: '/bench/7',
  pipeline: composed,
  handler: async () => new Ok({ n: 7 }),
});
export const e8 = httpEndpoint({
  method: 'GET',
  path: '/bench/8',
  pipeline: composed,
  handler: async () => new Ok({ n: 8 }),
});
export const e9 = httpEndpoint({
  method: 'GET',
  path: '/bench/9',
  pipeline: composed,
  handler: async () => new Ok({ n: 9 }),
});
export const e10 = httpEndpoint({
  method: 'GET',
  path: '/bench/10',
  pipeline: composed,
  handler: async () => new Ok({ n: 10 }),
});
export const e11 = httpEndpoint({
  method: 'GET',
  path: '/bench/11',
  pipeline: composed,
  handler: async () => new Ok({ n: 11 }),
});
export const e12 = httpEndpoint({
  method: 'GET',
  path: '/bench/12',
  pipeline: composed,
  handler: async () => new Ok({ n: 12 }),
});
export const e13 = httpEndpoint({
  method: 'GET',
  path: '/bench/13',
  pipeline: composed,
  handler: async () => new Ok({ n: 13 }),
});
export const e14 = httpEndpoint({
  method: 'GET',
  path: '/bench/14',
  pipeline: composed,
  handler: async () => new Ok({ n: 14 }),
});
export const e15 = httpEndpoint({
  method: 'GET',
  path: '/bench/15',
  pipeline: composed,
  handler: async () => new Ok({ n: 15 }),
});
export const e16 = httpEndpoint({
  method: 'GET',
  path: '/bench/16',
  pipeline: composed,
  handler: async () => new Ok({ n: 16 }),
});
export const e17 = httpEndpoint({
  method: 'GET',
  path: '/bench/17',
  pipeline: composed,
  handler: async () => new Ok({ n: 17 }),
});
export const e18 = httpEndpoint({
  method: 'GET',
  path: '/bench/18',
  pipeline: composed,
  handler: async () => new Ok({ n: 18 }),
});
export const e19 = httpEndpoint({
  method: 'GET',
  path: '/bench/19',
  pipeline: composed,
  handler: async () => new Ok({ n: 19 }),
});
export const e20 = httpEndpoint({
  method: 'GET',
  path: '/bench/20',
  pipeline: composed,
  handler: async () => new Ok({ n: 20 }),
});
export const e21 = httpEndpoint({
  method: 'GET',
  path: '/bench/21',
  pipeline: composed,
  handler: async () => new Ok({ n: 21 }),
});
export const e22 = httpEndpoint({
  method: 'GET',
  path: '/bench/22',
  pipeline: composed,
  handler: async () => new Ok({ n: 22 }),
});
export const e23 = httpEndpoint({
  method: 'GET',
  path: '/bench/23',
  pipeline: composed,
  handler: async () => new Ok({ n: 23 }),
});
export const e24 = httpEndpoint({
  method: 'GET',
  path: '/bench/24',
  pipeline: composed,
  handler: async () => new Ok({ n: 24 }),
});
export const e25 = httpEndpoint({
  method: 'GET',
  path: '/bench/25',
  pipeline: composed,
  handler: async () => new Ok({ n: 25 }),
});
export const e26 = httpEndpoint({
  method: 'GET',
  path: '/bench/26',
  pipeline: composed,
  handler: async () => new Ok({ n: 26 }),
});
export const e27 = httpEndpoint({
  method: 'GET',
  path: '/bench/27',
  pipeline: composed,
  handler: async () => new Ok({ n: 27 }),
});
export const e28 = httpEndpoint({
  method: 'GET',
  path: '/bench/28',
  pipeline: composed,
  handler: async () => new Ok({ n: 28 }),
});
export const e29 = httpEndpoint({
  method: 'GET',
  path: '/bench/29',
  pipeline: composed,
  handler: async () => new Ok({ n: 29 }),
});
export const e30 = httpEndpoint({
  method: 'GET',
  path: '/bench/30',
  pipeline: composed,
  handler: async () => new Ok({ n: 30 }),
});
export const e31 = httpEndpoint({
  method: 'GET',
  path: '/bench/31',
  pipeline: composed,
  handler: async () => new Ok({ n: 31 }),
});
export const e32 = httpEndpoint({
  method: 'GET',
  path: '/bench/32',
  pipeline: composed,
  handler: async () => new Ok({ n: 32 }),
});
export const e33 = httpEndpoint({
  method: 'GET',
  path: '/bench/33',
  pipeline: composed,
  handler: async () => new Ok({ n: 33 }),
});
export const e34 = httpEndpoint({
  method: 'GET',
  path: '/bench/34',
  pipeline: composed,
  handler: async () => new Ok({ n: 34 }),
});
export const e35 = httpEndpoint({
  method: 'GET',
  path: '/bench/35',
  pipeline: composed,
  handler: async () => new Ok({ n: 35 }),
});
export const e36 = httpEndpoint({
  method: 'GET',
  path: '/bench/36',
  pipeline: composed,
  handler: async () => new Ok({ n: 36 }),
});
export const e37 = httpEndpoint({
  method: 'GET',
  path: '/bench/37',
  pipeline: composed,
  handler: async () => new Ok({ n: 37 }),
});
export const e38 = httpEndpoint({
  method: 'GET',
  path: '/bench/38',
  pipeline: composed,
  handler: async () => new Ok({ n: 38 }),
});
export const e39 = httpEndpoint({
  method: 'GET',
  path: '/bench/39',
  pipeline: composed,
  handler: async () => new Ok({ n: 39 }),
});
export const e40 = httpEndpoint({
  method: 'GET',
  path: '/bench/40',
  pipeline: composed,
  handler: async () => new Ok({ n: 40 }),
});
export const e41 = httpEndpoint({
  method: 'GET',
  path: '/bench/41',
  pipeline: composed,
  handler: async () => new Ok({ n: 41 }),
});
export const e42 = httpEndpoint({
  method: 'GET',
  path: '/bench/42',
  pipeline: composed,
  handler: async () => new Ok({ n: 42 }),
});
export const e43 = httpEndpoint({
  method: 'GET',
  path: '/bench/43',
  pipeline: composed,
  handler: async () => new Ok({ n: 43 }),
});
export const e44 = httpEndpoint({
  method: 'GET',
  path: '/bench/44',
  pipeline: composed,
  handler: async () => new Ok({ n: 44 }),
});
export const e45 = httpEndpoint({
  method: 'GET',
  path: '/bench/45',
  pipeline: composed,
  handler: async () => new Ok({ n: 45 }),
});
export const e46 = httpEndpoint({
  method: 'GET',
  path: '/bench/46',
  pipeline: composed,
  handler: async () => new Ok({ n: 46 }),
});
export const e47 = httpEndpoint({
  method: 'GET',
  path: '/bench/47',
  pipeline: composed,
  handler: async () => new Ok({ n: 47 }),
});
export const e48 = httpEndpoint({
  method: 'GET',
  path: '/bench/48',
  pipeline: composed,
  handler: async () => new Ok({ n: 48 }),
});
export const e49 = httpEndpoint({
  method: 'GET',
  path: '/bench/49',
  pipeline: composed,
  handler: async () => new Ok({ n: 49 }),
});

export const probeHover = composed;
export const probeCompletion = composed.bind(resolve);

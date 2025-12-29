import { fromScratch } from './from-scratch.fn';
import { fromType } from './from-type.fn';

import { z } from 'zod';

describe('defineModel', () => {
  it('should create schema without explicit type (type inference)', () => {
    const schema = fromScratch().defineModel(
      z.object({
        a: z.number().describe('First number'),
        b: z.string().describe('Second value'),
      }),
    );

    expect(schema).toBeDefined();
    expect(schema.shape).toHaveProperty('a');
    expect(schema.shape).toHaveProperty('b');
  });

  it('should return zod schema directly', () => {
    const schema = fromScratch().defineModel(
      z.object({
        field1: z.string().describe('Field 1'),
        field2: z.number().describe('Field 2'),
      }),
    );

    expect(schema).toBeDefined();
    expect(schema).toBeInstanceOf(z.ZodObject);
  });
});

describe('forType().defineModel', () => {
  it('should create schema with explicit type and type narrowing', () => {
    interface UserProto {
      name?: string;
      email?: string;
    }

    const schema = fromType<UserProto>().defineModel(
      z.object({
        name: z.string().min(1).describe('User name'),
        email: z.email().describe('User email'),
      }),
    );

    expect(schema).toBeDefined();
    expect(schema.shape).toHaveProperty('name');
    expect(schema.shape).toHaveProperty('email');
  });

  it('should support nested objects with type narrowing', () => {
    interface UserProto {
      address?: {
        street?: string;
        city?: string;
      };
    }

    const schema = fromType<UserProto>().defineModel(
      z.object({
        address: z
          .object({
            street: z.string(),
            city: z.string(),
          })
          .describe('User address'),
      }),
    );

    expect(schema).toBeDefined();
    expect('shape' in schema && schema.shape).toHaveProperty('address');
  });

  describe('valid narrowings (compile-time checks)', () => {
    it('should allow making optional fields required', () => {
      interface UserProto {
        name?: string;
        email?: string;
      }

      // Валидное сужение: optional → required
      const schema = fromType<UserProto>().defineModel(
        z.object({
          name: z.string().min(1),
          email: z.string().email(),
        }),
      );

      expect(schema).toBeDefined();
      expect(schema.shape).toHaveProperty('name');
      expect(schema.shape).toHaveProperty('email');
    });

    it('should allow narrowing string to literal types', () => {
      interface UserProto {
        role?: string;
      }

      // Валидное сужение: string → enum
      const schema = fromType<UserProto>().defineModel(
        z.object({
          role: z.enum(['admin', 'user', 'guest']),
        }),
      );

      expect(schema).toBeDefined();
      expect(schema.shape).toHaveProperty('role');
    });

    it('should allow subset of optional fields', () => {
      interface UserProto {
        name?: string;
        email?: string;
        phone?: string;
      }

      // Валидное сужение: использование подмножества полей
      const schema = fromType<UserProto>().defineModel(
        z.object({
          name: z.string(),
        }),
      );

      expect(schema).toBeDefined();
      expect(schema.shape).toHaveProperty('name');
      expect(schema.shape).not.toHaveProperty('email');
    });

    it('should allow narrowing number with constraints', () => {
      interface UserProto {
        age?: number;
      }

      // Валидное сужение: добавление ограничений
      const schema = fromType<UserProto>().defineModel(
        z.object({
          age: z.number().min(0).max(120),
        }),
      );

      expect(schema).toBeDefined();
      expect(schema.shape).toHaveProperty('age');
    });

    it('should allow wider type narrowing to specific type', () => {
      interface UserProto {
        data?: unknown;
      }

      // Валидное сужение: unknown → string
      const schema = fromType<UserProto>().defineModel(
        z.object({
          data: z.string(),
        }),
      );

      expect(schema).toBeDefined();
      expect(schema.shape).toHaveProperty('data');
    });
  });

  describe('invalid narrowings (compilation errors)', () => {
    it('should reject when adding fields not in domain type', () => {
      interface UserProto {
        name?: string;
      }

      fromType<UserProto>().defineModel(
        // @ts-expect-error - поле 'age' отсутствует в UserProto
        z.object({
          name: z.string(),
          age: z.number(), // это поле не существует в UserProto
        }),
      );
    });

    it('should reject when using incompatible types', () => {
      interface UserProto {
        id?: string;
      }

      fromType<UserProto>().defineModel(
        // @ts-expect-error - id должен быть string, а не number
        z.object({
          id: z.number(), // несовместимый тип
        }),
      );
    });

    it('should reject when narrowing from required to optional', () => {
      interface UserProto {
        name: string; // обязательное поле
      }

      fromType<UserProto>().defineModel(
        // @ts-expect-error - нельзя сделать обязательное поле optional
        z.object({
          name: z.string().optional(), // попытка сделать optional
        }),
      );
    });

    it('should reject completely unrelated type', () => {
      interface UserProto {
        name?: string;
      }

      fromType<UserProto>().defineModel(
        // @ts-expect-error - полностью другая структура
        z.object({
          email: z.string(),
          phone: z.string(),
        }),
      );
    });

    it('should reject incompatible nested object types', () => {
      interface UserProto {
        profile?: {
          age?: number;
        };
      }

      fromType<UserProto>().defineModel(
        // @ts-expect-error - age должен быть number, а не string
        z.object({
          profile: z.object({
            age: z.string(), // несовместимый тип в nested object
          }),
        }),
      );
    });

    it('should reject when adding extra nested fields', () => {
      interface UserProto {
        settings?: {
          theme?: string;
        };
      }

      fromType<UserProto>().defineModel(
        // @ts-expect-error - поле 'language' отсутствует в settings
        z.object({
          settings: z.object({
            theme: z.string(),
            language: z.string(), // дополнительное поле
          }),
        }),
      );
    });
  });

  describe('transforms with forType', () => {
    it('should support basic transforms', () => {
      interface UserProto {
        id?: string;
      }

      const schema = fromType<UserProto>().defineModel(
        z.object({
          id: z.string().transform((val) => Number.parseInt(val, 10)),
        }),
      );

      expect(schema).toBeDefined();
      expect(schema.shape).toHaveProperty('id');
    });

    it('should transform string to number with validation', () => {
      interface GetUserProto {
        id?: string;
        page?: string;
      }

      const schema = fromType<GetUserProto>().defineModel(
        z.object({
          id: z
            .string()
            .regex(/^\d+$/)
            .transform((val) => Number.parseInt(val, 10)),
          page: z
            .string()
            .optional()
            .transform((val) => (val ? Number.parseInt(val, 10) : undefined)),
        }),
      );

      expect(schema).toBeDefined();

      // Проверяем что схема валидирует и трансформирует
      const result = schema.parse({ id: '123', page: '5' });
      expect(result.id).toBe(123);
      expect(result.page).toBe(5);
    });

    it('should transform Bearer token by removing prefix', () => {
      interface AuthProto {
        authorization?: string;
      }

      const schema = fromType<AuthProto>().defineModel(
        z.object({
          authorization: z
            .string()
            .regex(/^Bearer .+$/)
            .transform((val) => val.replace('Bearer ', '')),
        }),
      );

      expect(schema).toBeDefined();

      const result = schema.parse({ authorization: 'Bearer token123' });
      expect(result.authorization).toBe('token123');
    });

    it('should support chained transforms', () => {
      interface UserProto {
        email?: string;
      }

      const schema = fromType<UserProto>().defineModel(
        z.object({
          email: z
            .string()
            .transform((val) => val.toLowerCase())
            .transform((val) => val.trim()),
        }),
      );

      expect(schema).toBeDefined();

      const result = schema.parse({ email: '  USER@EXAMPLE.COM  ' });
      expect(result.email).toBe('user@example.com');
    });

    it('should transform nested objects', () => {
      interface UserProto {
        metadata?: {
          createdAt?: string;
        };
      }

      const schema = fromType<UserProto>().defineModel(
        z.object({
          metadata: z.object({
            createdAt: z.string().transform((val) => new Date(val)),
          }),
        }),
      );

      expect(schema).toBeDefined();

      const result = schema.parse({
        metadata: { createdAt: '2024-01-01T00:00:00Z' },
      });
      expect(result.metadata.createdAt).toBeInstanceOf(Date);
    });

    it('should support transform with refinement', () => {
      interface UserProto {
        age?: string;
      }

      const schema = fromType<UserProto>().defineModel(
        z.object({
          age: z
            .string()
            .transform((val) => Number.parseInt(val, 10))
            .refine((val) => val >= 0 && val <= 150, {
              message: 'Age must be between 0 and 150',
            }),
        }),
      );

      expect(schema).toBeDefined();

      const validResult = schema.parse({ age: '25' });
      expect(validResult.age).toBe(25);

      expect(() => schema.parse({ age: '200' })).toThrow();
    });

    it('should allow transform that changes output type from input', () => {
      interface ProtoType {
        timestamp?: string;
        count?: string;
      }

      // Input: string, Output: Date | number
      const schema = fromType<ProtoType>().defineModel(
        z.object({
          timestamp: z.string().transform((val) => new Date(val)),
          count: z.string().transform((val) => Number.parseInt(val, 10)),
        }),
      );

      expect(schema).toBeDefined();

      const result = schema.parse({
        timestamp: '2024-01-01T00:00:00Z',
        count: '42',
      });

      expect(result.timestamp).toBeInstanceOf(Date);
      expect(typeof result.count).toBe('number');
      expect(result.count).toBe(42);
    });

    it('should work with optional transforms', () => {
      interface UserProto {
        phone?: string;
      }

      const schema = fromType<UserProto>().defineModel(
        z.object({
          phone: z
            .string()
            .optional()
            .transform((val) => val?.replace(/\D/g, '')),
        }),
      );

      expect(schema).toBeDefined();

      const result1 = schema.parse({ phone: '+1 (555) 123-4567' });
      expect(result1.phone).toBe('15551234567');

      const result2 = schema.parse({});
      expect(result2.phone).toBeUndefined();
    });

    it('should transform array elements', () => {
      interface UserProto {
        tags?: string[];
      }

      const schema = fromType<UserProto>().defineModel(
        z.object({
          tags: z
            .array(z.string())
            .transform((arr) => arr.map((tag) => tag.toLowerCase())),
        }),
      );

      expect(schema).toBeDefined();

      const result = schema.parse({ tags: ['FOO', 'Bar', 'BAZ'] });
      expect(result.tags).toEqual(['foo', 'bar', 'baz']);
    });
  });

  describe('transforms with defineModel (without explicit type)', () => {
    it('should support transforms without type parameter', () => {
      const schema = fromScratch().defineModel(
        z.object({
          id: z.string().transform((val) => Number.parseInt(val, 10)),
          name: z.string(),
        }),
      );

      expect(schema).toBeDefined();

      const result = schema.parse({ id: '123', name: 'Alice' });
      expect(result.id).toBe(123);
      expect(result.name).toBe('Alice');
    });

    it('should support complex transforms', () => {
      const schema = fromScratch().defineModel(
        z.object({
          email: z.email().transform((val) => val.toLowerCase()),
          createdAt: z.iso.datetime().transform((val) => new Date(val)),
        }),
      );

      expect(schema).toBeDefined();

      const result = schema.parse({
        email: 'USER@EXAMPLE.COM',
        createdAt: '2024-01-01T00:00:00Z',
      });

      expect(result.email).toBe('user@example.com');
      expect(result.createdAt).toBeInstanceOf(Date);
    });
  });
});

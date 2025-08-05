import { z } from 'zod'

// Validación para campos individuales
export const fieldSchema = z.object({
  title: z.string().min(1, 'Field title is required'),
  property: z.string().min(1, 'Field property is required'),
  value: z.string(),
  secret: z.boolean(),
})

// Validación para el formulario de entrada
export const addEntryFormSchema = z.object({
  entryTitle: z.string().min(1, 'Entry title is required').max(100, 'Entry title must be 100 characters or less'),
  fields: z.array(fieldSchema).min(1, 'At least one field is required'),
  tags: z.array(z.string().min(1, 'Tag cannot be empty').max(30, 'Tag must be 30 characters or less')),
})

// Tipo inferido del esquema
export type AddEntryFormData = z.infer<typeof addEntryFormSchema>

// Validación para actualización de campos
export const updateFieldSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  property: z.string().min(1, 'Property is required'),
  value: z.string(),
  secret: z.boolean(),
})

// Validación para tags
export const tagSchema = z.string().min(1, 'Tag cannot be empty').max(30, 'Tag must be 30 characters or less')
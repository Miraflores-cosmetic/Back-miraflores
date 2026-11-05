-- Дефолтная статья «Правила приобретения пробников» (slug из CartSettings / API samples/rules).
INSERT INTO "BlogPost" (
  "id",
  "slug",
  "title",
  "body",
  "isPublished",
  "publishedAt",
  "sortOrder",
  "createdAt",
  "updatedAt"
)
VALUES (
  'cm2sample000rules000article00001',
  'pravila-priobreteniya-probnikov',
  'Правила приобретения пробников',
  '<p>Условия заказа пробников интернет-магазина Miraflores. Пробники доступны зарегистрированным покупателям, один раз на каждый вариант, в количестве 1 шт.</p>',
  true,
  NOW(),
  0,
  NOW(),
  NOW()
)
ON CONFLICT ("slug") DO NOTHING;

FROM php:8.2-apache

RUN apt-get update \
	&& apt-get install -y --no-install-recommends libpq-dev \
	&& docker-php-ext-install pdo_pgsql \
	&& docker-php-ext-enable pdo_pgsql \
	&& php -m | grep -q '^pdo_pgsql$' \
	&& rm -rf /var/lib/apt/lists/*

RUN printf '%s\n' 'DirectoryIndex index.php index.html index/index.html' \
	> /etc/apache2/conf-available/ticketing-directory-index.conf \
	&& a2enconf ticketing-directory-index

COPY . /var/www/html/

RUN chown -R www-data:www-data /var/www/html

EXPOSE 80

CMD ["apache2-foreground"]

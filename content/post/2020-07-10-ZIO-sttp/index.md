+++
title = "Mocking endpoints with ZIO sttp"
date = 2020-07-10
Author = "The Editor"
+++

_How to use ZIO modules together with STTP_

<!--more-->

In this post I want to give a simple example of how to use ZIO modules together with STTP. We will see how to wire different components together and in particular how to unit test the http layer. I assume basic ZIO concepts such as environment, layer, error and ZIO aliases (`RIO`, `UIO` etc) are already known to the reader, who can refer to ZIO documentation for further details. The code used along this article is available [here](https://github.com/pierangeloc/blog-zio-sttp).


Our client is working on a marketing campaign. Colleagues from marketing department prepared a list of `CustomerId`, and we are tasked to send each user an email with a promotion for the hot product of our catalogue. The user information is stored in a CRM application that exposes a REST api.

To implement this, for each `CustomerId` we need to:

- lookup for the customer in the CRM
- if customer exists and permission has been granted, send the email
- otherwise just write a log message

### The CRM application
We have a simple implementation of the CRM api we want to use, i.e. an endpoint to fetch a user given a `userId`. You can run a trivial implementation of such an application with `sbt runMain io.tuliplogic.CRMApp`. Let's test the endpoint with [httpPie](https://httpie.org/):

```
http http://localhost:8080/users/123123
HTTP/1.1 200 OK
Connection: keep-alive
Content-Length: 73
Content-Type: text/plain
Date: Sat, 11 Jul 2020 14:25:19 GMT

{
    "email": "weierstrass@maths.com",
    "promotionOptIn": true,
    "userId": "123123"
}
```

If a user is not found in CRM, the service returns a 404 with emtpy body instead.

### The campaign
Our campaign program is given a `val customerIds: List[CustomerId]` and a simple function to send email `def sendEmail(email: Email): URIO[Console, Unit] = ???`. We will focus on the service responsible for retrieving customer information. Writing a module that exposes such a functionality is pretty straightforward:

```scala
type CustomerDataService = Has[CustomerDataService.Service]

object CustomerBaseService {
  trait Service {
    def getCustomer(customerId: CustomerId): IO[Error, Option[Customer]]
  }

  def getCustomer(customerId: CustomerId): ZIO[CustomerBaseService, Error, Option[Customer]] =
    ZIO.accessM(_.get.getCustomer(customerId))
}
```

Based solely on the shape of our interface (we didn't bother yet thinking about the concrete implementation), we can write the campaign program as

```scala
val program: ZIO[Console with CustomerDataService, CustomerDataService.Error, Unit] =
  ZIO.foreach(customerIds) { customerId =>
    CustomerDataService.getCustomer(customerId).flatMap {
      _.fold(console.putStrLn(s"Customer $customerId not found"))( cust =>
        if (cust.promotionOptIn) sendEmail(cust.email)
        else console.putStrLn(s"Not sending email to $customerId")
      )
    }
  }.unit
```

The type of `program` tells us it requires `Console with CustomerDataService`, `Console` being provided by `ZEnv` and `CustomerDataService` must be provided by us.
  
A `live` implementation of `CustomerDataService` layer must perform an http call to our CRM (configurable) endpoint, therefore it depends on a horizontal composition of a `Config` layer that provides the base url and port, together with `SttpClient` layer provided by [**sttp-zio**](https://sttp.softwaremill.com/en/latest/backends/zio.html). In order to parse the response properly, we use [**sttp-circe**](https://sttp.softwaremill.com/en/latest/json.html#circe).

```scala
val live: URLayer[SttpClient with Config, CustomerDataService] =
  ZLayer.fromServiceM[io.tuliplogic.Config, SttpClient, Nothing, Service] { config =>
    ZIO.fromFunction[SttpClient, Service] { sttpClient =>
      new Service {
        override def getCustomer(customerId: CustomerId): IO[Error, Option[Customer]] = {
          val request = basicRequest
            .get(uri"${config.baseUrl}:${config.port}/customers/${customerId.value}")
            .response(asJson[Customer])
          (
            for {
              resp <- SttpClient.send(request)
                .mapError(t => Error("Connection Error", t))
              res <- (resp.code, resp.body) match {
                case (StatusCode.NotFound, _) => ZIO.none
                case (_, Right(customer))         => ZIO.some(customer)
                case (_, Left(e))             => ZIO.fail(Error("API error", e))
              }
            } yield res
          ).provide(sttpClient)
        }
      }
    }
  }
```

**sttp** allows us to _describe_ how we send a request and we parse the response. This description is then _interpreted_ in the `SttpClient.send` that returns a `ZIO` effect. Here we are transforming the response with 404 status code into a `None`, the 200 response into a `Some[Customer]`, otherwise we fail the effect using the `ZIO` error channel.

In the main program we need to satisfy the requirements of `program` using the `live` layer, after we compose the requirements horizontally with `++` and vertically with `>>>` (see [here](https://zio.dev/docs/howto/howto_use_layers) for further details).

```scala
program.provideSomeLayer[Console](
  (ZLayer.succeed(Config("http://localhost", 8080)) ++ AsyncHttpClientZioBackend.layer()) >>> CustomerDataService.live
)
```

### Unit testing the `live` layer

Given how we composed the different parts of our program, we are pretty confident it will work, just it would be nice to make sure
the http part has been implemented correctly, in `CustomerDataService.live`. In particular we want to make sure we are processing correctly the faulty situations.

With **sttp** and `ZIO` mocking http endpoints is extremely simple. I used `ScalaTest` but a similar approach can be followed with pretty much all the testing libraries out there. The http dependency in `live` is provided by `SttpClient` layer, so to mock a situation where the CRM endpoint returns a 404 we build an sttp layer as

```scala
val notFoundSttp: ULayer[SttpClient] = ZLayer.succeed(
  AsyncHttpClientZioBackend.stub
    .whenRequestMatches(req => req.uri.toString == "http://localhost:8080/customers/123122")
    .thenRespondNotFound()
)
```

and in the test we inject this layer as `SttpClient` and run the method under test

```scala
"return None when customer not found" in new TestScope {
  val res = unsafeRun(
    CustomerDataService.getCustomer(CustomerId("123122")).provideLayer(
      (configLayer ++ notFoundSttp  ) >>> CustomerDataService.live
    ).either
  )

  val expected = Right(None)
  res shouldEqual expected
}
```

# Conclusion
Through this simple example, we saw how we can use **sttp** together with `ZIO` using the `ZLayer` approach, and we have shown how to
unit test the http client without having to spin any server, by just providing a properly setup `SttpClient`.

